/**
 * {@link MavlinkHost} — the main-thread client of the MAVLink worker (task
 * T1.9; spec plan/02 §2.1/§2.6).
 *
 * It owns the transport (Web Serial / WebSocket / replay are main-thread APIs)
 * and acts as a THIN BYTE RELAY between the wire and the worker:
 *
 *  - inbound:  `transport.readable` → {@link RPC_INGEST_BYTES} (worker parses)
 *  - outbound: worker {@link RPC_OUTGOING} stream → `transport.writable`
 *
 * No parsing happens on the main thread. The worker emits coalesced
 * {@link TelemetrySnapshot}s over {@link RPC_TELEMETRY}; this host overlays the
 * transport's byte/rssi/signed counters onto each vehicle's {@link LinkStats}
 * so the UI sees a complete link record.
 *
 * Auto-reconnect is the transport's / connection-manager's concern (T1.10); this
 * host does not implement retry.
 */
import MavlinkWorker from '../../workers/mavlink.worker.ts?worker&inline';
import { type PostMessageRpc, createRpc } from '../../core/bus';
import type { ConnState, LinkStats, Transport } from '../../contracts';
import { BUILTIN_TRANSPORT_FACTORIES } from '../../transport';
import {
  RPC_CONFIGURE,
  RPC_INGEST_BYTES,
  RPC_OUTGOING,
  RPC_RESET,
  RPC_SEND_MESSAGE,
  RPC_TELEMETRY,
  type ConfigureRequest,
  type SendMessageRequest,
} from './protocol';
import type { TelemetrySnapshot } from './session';

/** Callback for coalesced telemetry snapshots (link stats already overlaid). */
export type TelemetryListener = (snapshot: TelemetrySnapshot) => void;
/** Callback for connection-state transitions. */
export type StateListener = (state: ConnState) => void;

/** Construction options for {@link MavlinkHost}. */
export interface MavlinkHostOptions {
  /** Coalesced-telemetry cadence in Hz (default: worker default ~25 Hz). */
  telemetryHz?: number;
  /** GCS heartbeat cadence in Hz (default: worker default 1 Hz). */
  heartbeatHz?: number;
}

function zeroLink(): LinkStats {
  return { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false };
}

/**
 * Overlay the transport's byte/rssi/signed counters onto every vehicle's link
 * record (the worker fills only the registry-derived rate/loss/packets fields).
 */
function overlayTransportStats(snapshot: TelemetrySnapshot, t: LinkStats): void {
  for (const v of snapshot.vehicles) {
    v.link.bytesIn = t.bytesIn;
    v.link.bytesOut = t.bytesOut;
    v.link.signed = t.signed;
    if (t.rssi !== undefined) v.link.rssi = t.rssi;
  }
}

/** Main-thread MAVLink host: transport ownership + byte relay + telemetry fan-out. */
export class MavlinkHost {
  private readonly worker: Worker;
  private readonly rpc: PostMessageRpc;
  private readonly options: MavlinkHostOptions;
  private readonly stateListeners = new Set<StateListener>();
  private readonly telemetryListeners = new Set<TelemetryListener>();

  private transport: Transport | undefined;
  private transportUnsub: (() => void) | undefined;
  private reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  private writer: WritableStreamDefaultWriter<Uint8Array> | undefined;
  private telemetryAbort: AbortController | undefined;
  private outgoingAbort: AbortController | undefined;
  /** Serializes outgoing writes so frames reach the wire in order. */
  private writeChain: Promise<void> = Promise.resolve();
  private latest: TelemetrySnapshot | undefined;
  private disposed = false;

  constructor(options: MavlinkHostOptions = {}) {
    this.options = options;
    this.worker = new MavlinkWorker();
    this.rpc = createRpc(this.worker);
  }

  /**
   * Open `factoryId` from {@link BUILTIN_TRANSPORT_FACTORIES} with `config`, then
   * start the inbound + outbound byte relays and the telemetry stream. Rejects if
   * the factory is unknown or `transport.open` fails.
   */
  async connect(factoryId: string, config: unknown): Promise<void> {
    if (this.disposed) throw new Error('MavlinkHost disposed');
    if (this.transport) await this.disconnect();

    const factory = BUILTIN_TRANSPORT_FACTORIES.find((f) => f.id === factoryId);
    if (factory === undefined) throw new Error(`unknown transport factory: ${factoryId}`);

    const transport = factory.create();
    this.transport = transport;
    this.transportUnsub = transport.onState((s) => this.emitState(s));

    this.emitState({ kind: 'opening' });
    await this.rpc.call(RPC_RESET, undefined);
    await transport.open(config);

    this.startTelemetry();
    this.startOutgoing(transport);
    this.startInbound(transport);
  }

  /** Stop all relays and close the transport. Safe to call when not connected. */
  async disconnect(): Promise<void> {
    this.telemetryAbort?.abort();
    this.telemetryAbort = undefined;
    this.outgoingAbort?.abort();
    this.outgoingAbort = undefined;

    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch {
        /* reader already errored/closed */
      }
      this.reader = undefined;
    }
    if (this.writer) {
      try {
        await this.writer.close();
      } catch {
        /* writer already errored/closed */
      }
      this.writer = undefined;
    }

    this.transportUnsub?.();
    this.transportUnsub = undefined;

    const transport = this.transport;
    this.transport = undefined;
    if (transport) {
      try {
        await transport.close();
      } catch {
        /* already closed */
      }
    }
    this.latest = undefined;
    this.emitState({ kind: 'closed' });
  }

  /** Encode + send `name`/`fields` (worker-side) out the active transport. */
  async sendMessage(name: string, fields: Record<string, unknown>): Promise<void> {
    const req: SendMessageRequest = { name, fields };
    await this.rpc.call(RPC_SEND_MESSAGE, req);
  }

  /** Install / update / disable (pass `null`) MAVLink v2 signing. */
  async configure(opts: ConfigureRequest): Promise<void> {
    await this.rpc.call(RPC_CONFIGURE, opts);
  }

  /** Subscribe to connection-state transitions; returns an unsubscribe fn. */
  onState(cb: StateListener): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  /** Subscribe to coalesced telemetry snapshots; returns an unsubscribe fn. */
  onTelemetry(cb: TelemetryListener): () => void {
    this.telemetryListeners.add(cb);
    return () => {
      this.telemetryListeners.delete(cb);
    };
  }

  /**
   * Aggregate link stats: the transport's byte/rssi/signed counters merged with
   * the registry-derived packets/rate/loss summed across all vehicles in the
   * latest snapshot — a complete {@link LinkStats} for the UI.
   */
  stats(): LinkStats {
    const t = this.transport?.stats() ?? zeroLink();
    let packetsIn = 0;
    let rateHz = 0;
    let lossPct = 0;
    for (const v of this.latest?.vehicles ?? []) {
      packetsIn += v.link.packetsIn;
      rateHz += v.link.rateHz;
      lossPct = Math.max(lossPct, v.link.lossPct);
    }
    return {
      bytesIn: t.bytesIn,
      bytesOut: t.bytesOut,
      packetsIn,
      lossPct,
      rateHz,
      ...(t.rssi !== undefined ? { rssi: t.rssi } : {}),
      signed: t.signed,
    };
  }

  /** Tear down: disconnect, drop the RPC, and terminate the worker. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.disconnect();
    this.rpc.dispose();
    this.worker.terminate();
    this.stateListeners.clear();
    this.telemetryListeners.clear();
  }

  // --- relays -------------------------------------------------------------

  private startTelemetry(): void {
    const abort = new AbortController();
    this.telemetryAbort = abort;
    const hz = this.options.telemetryHz;
    void this.rpc
      .stream<{ hz?: number }, TelemetrySnapshot>(
        RPC_TELEMETRY,
        hz !== undefined ? { hz } : {},
        (snap) => this.onSnapshot(snap),
        { signal: abort.signal },
      )
      .catch(() => {
        /* aborted on disconnect — expected */
      });
  }

  private startOutgoing(transport: Transport): void {
    const writer = transport.writable.getWriter();
    this.writer = writer;
    const abort = new AbortController();
    this.outgoingAbort = abort;
    const heartbeatHz = this.options.heartbeatHz;
    void this.rpc
      .stream<{ heartbeatHz?: number }, Uint8Array>(
        RPC_OUTGOING,
        heartbeatHz !== undefined ? { heartbeatHz } : {},
        (frame) => this.enqueueWrite(writer, frame),
        { signal: abort.signal },
      )
      .catch(() => {
        /* aborted on disconnect — expected */
      });
  }

  private startInbound(transport: Transport): void {
    const reader = transport.readable.getReader();
    this.reader = reader;
    void this.pumpInbound(reader);
  }

  private async pumpInbound(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value !== undefined && value.byteLength > 0) {
          await this.rpc.call(RPC_INGEST_BYTES, value);
        }
      }
    } catch (err) {
      if (!this.disposed && this.transport) {
        this.emitState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  private enqueueWrite(writer: WritableStreamDefaultWriter<Uint8Array>, frame: Uint8Array): void {
    this.writeChain = this.writeChain
      .then(() => writer.write(frame))
      .catch((err: unknown) => {
        if (!this.disposed && this.transport) {
          this.emitState({
            kind: 'error',
            message: err instanceof Error ? err.message : String(err),
          });
        }
      });
  }

  private onSnapshot(snapshot: TelemetrySnapshot): void {
    if (this.transport) overlayTransportStats(snapshot, this.transport.stats());
    this.latest = snapshot;
    for (const cb of this.telemetryListeners) cb(snapshot);
  }

  private emitState(state: ConnState): void {
    for (const cb of this.stateListeners) cb(state);
  }
}
