/**
 * {@link ConnectionManager} — the main-thread owner of a single live MAVLink
 * link (task T1.10; spec plan/03 §3.5 "Connection manager", §3.7; plan/04 §4.1).
 *
 * It wraps a {@link MavlinkHostLike} (the real {@link import('../../mavlink/host').MavlinkHost})
 * and turns the host's two raw event streams — connection-state transitions and
 * coalesced telemetry snapshots — into a small, UI-friendly surface:
 *
 *  - `connect(factoryId, config)` / `disconnect()` drive the active link.
 *  - `onState` / `onTelemetry` fan out de-duplicated state + telemetry events.
 *  - it is multi-vehicle aware: telemetry carries every detected vehicle (routed
 *    by `sysid` upstream in the worker registry) and the manager tracks an ACTIVE
 *    vehicle — the user's explicit selection when present, otherwise the
 *    most-recently-heard vehicle from the snapshot.
 *  - `stats()` returns the host's merged {@link LinkStats} (rate / loss / rssi /
 *    signed / bytes) for the diagnostics readout.
 *
 * The manager owns NO transport or worker directly; that is the host's job. By
 * depending only on the structural {@link MavlinkHostLike} interface it stays
 * unit-testable with a mock host (no real Worker is spun for tests). A single
 * active link is sufficient for M1; the API is shaped so multi-link routing can
 * grow behind it later without changing consumers.
 */
import type { ConnState, LinkStats, VehicleState } from '../../contracts';
import {
  createStreamRateService,
  type StreamRateService,
} from '../../mavlink/microservices/streams';

/**
 * The minimal telemetry shape the manager consumes from the host. The real
 * host emits a richer `TelemetrySnapshot` (which also carries inspector rates
 * and a revision counter); this is the structural subset the manager needs, so
 * a `TelemetrySnapshot` is assignable here without importing the worker host.
 */
export interface HostTelemetry {
  /** Every currently-known vehicle, keyed upstream by `(sysid, compid)`. */
  readonly vehicles: readonly VehicleState[];
  /** The most-recently-heard vehicle's `sysid`, if any vehicle is known. */
  readonly activeSysid?: number;
}

/**
 * The slice of {@link import('../../mavlink/host').MavlinkHost} the manager
 * depends on. Declaring it structurally keeps this module free of the host's
 * `?worker&inline` import, so importing the manager never pulls the worker into
 * a test bundle and the manager can be exercised with a lightweight mock.
 */
export interface MavlinkHostLike {
  /** Open `factoryId` (from the built-in transport factories) with `config`. */
  connect(factoryId: string, config: unknown): Promise<void>;
  /** Close the active link; safe when not connected. */
  disconnect(): Promise<void>;
  /** Encode + send a message out the active link (worker-side encode). */
  sendMessage(name: string, fields: Record<string, unknown>): Promise<void>;
  /** Subscribe to connection-state transitions; returns an unsubscribe fn. */
  onState(cb: (s: ConnState) => void): () => void;
  /** Subscribe to coalesced telemetry snapshots; returns an unsubscribe fn. */
  onTelemetry(cb: (t: HostTelemetry) => void): () => void;
  /** Merged link statistics (transport bytes/rssi + registry rate/loss). */
  stats(): LinkStats;
  /** Tear down the host and terminate its worker. */
  dispose(): Promise<void>;
}

/** A coalesced telemetry event surfaced to the UI by the manager. */
export interface ConnectionTelemetry {
  /** All currently-detected vehicles (sorted upstream by `(sysid, compid)`). */
  readonly vehicles: readonly VehicleState[];
  /** The resolved ACTIVE `sysid` (user selection if valid, else most-recent). */
  readonly activeSysid: number | undefined;
  /** The merged link diagnostics at snapshot time. */
  readonly stats: LinkStats;
}

/** Connection-state listener. */
export type ConnectionStateListener = (s: ConnState) => void;
/** Telemetry listener (vehicles + active selection + diagnostics). */
export type ConnectionTelemetryListener = (t: ConnectionTelemetry) => void;

/** Construction options for {@link ConnectionManager}. */
export interface ConnectionManagerOptions {
  /** The MAVLink host this manager drives. */
  readonly host: MavlinkHostLike;
}

/** A fresh zeroed {@link LinkStats} for the pre-connection diagnostics state. */
function zeroLink(): LinkStats {
  return { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false };
}

/**
 * Owns one MAVLink host and exposes a small reactive-friendly surface for the
 * connection drawer + app wiring. See the file header for the contract.
 */
export class ConnectionManager {
  private readonly host: MavlinkHostLike;
  private readonly stateListeners = new Set<ConnectionStateListener>();
  private readonly telemetryListeners = new Set<ConnectionTelemetryListener>();
  private readonly hostUnsubs: Array<() => void> = [];

  private currentState: ConnState = { kind: 'closed' };
  private currentVehicles: readonly VehicleState[] = [];
  /** `activeSysid` reported by the latest snapshot (most-recent heartbeat). */
  private snapshotActiveSysid: number | undefined;
  /** The user's explicit active-vehicle selection, if any. */
  private selectedSysid: number | undefined;
  /** The transport factory id of the active/last connect attempt. */
  private activeFactoryId: string | undefined;
  /**
   * Stream-rate requester for the current open session (T1.11). Created on the
   * transition to `open` and dropped on `closed`, so {@link requestDefaultSet}
   * runs exactly once per open session.
   */
  private streams: StreamRateService | undefined;
  private disposed = false;

  constructor(options: ConnectionManagerOptions) {
    this.host = options.host;
    this.hostUnsubs.push(this.host.onState((s) => this.onHostState(s)));
    this.hostUnsubs.push(this.host.onTelemetry((t) => this.onHostTelemetry(t)));
  }

  /**
   * Open `factoryId` with `config`. Connection-state transitions arrive through
   * {@link onState}. If the host rejects (e.g. the user cancels the serial port
   * prompt, or the bridge URL is unreachable) the manager surfaces an `error`
   * state and re-throws so the caller can show inline feedback.
   */
  async connect(factoryId: string, config: unknown): Promise<void> {
    if (this.disposed) throw new Error('ConnectionManager disposed');
    this.activeFactoryId = factoryId;
    this.selectedSysid = undefined;
    try {
      await this.host.connect(factoryId, config);
    } catch (err) {
      this.onHostState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  /** Close the active link and clear detected vehicles. Safe when idle. */
  async disconnect(): Promise<void> {
    this.selectedSysid = undefined;
    this.activeFactoryId = undefined;
    await this.host.disconnect();
  }

  /** Encode + send a message out the active link (passthrough to the host). */
  async sendMessage(name: string, fields: Record<string, unknown>): Promise<void> {
    await this.host.sendMessage(name, fields);
  }

  /** The current connection state. */
  state(): ConnState {
    return this.currentState;
  }

  /** All currently-detected vehicles. */
  vehicles(): readonly VehicleState[] {
    return this.currentVehicles;
  }

  /** The resolved ACTIVE `sysid`, or `undefined` when no vehicle is known. */
  activeSysid(): number | undefined {
    return this.resolveActiveSysid();
  }

  /** The resolved ACTIVE vehicle record, or `undefined`. */
  activeVehicle(): VehicleState | undefined {
    const sysid = this.resolveActiveSysid();
    if (sysid === undefined) return undefined;
    return this.currentVehicles.find((v) => v.sysid === sysid);
  }

  /** The transport factory id of the active/last connection, if any. */
  factoryId(): string | undefined {
    return this.activeFactoryId;
  }

  /**
   * Select the ACTIVE vehicle by `sysid`. The selection persists across
   * snapshots and falls back to the most-recently-heard vehicle whenever the
   * chosen `sysid` is not present. Pass `undefined` to clear and revert to the
   * automatic most-recent selection. Emits a telemetry event so consumers
   * re-render.
   */
  setActiveVehicle(sysid: number | undefined): void {
    this.selectedSysid = sysid;
    this.emitTelemetry();
  }

  /** Merged link diagnostics (rate / loss / rssi / signed / bytes). */
  stats(): LinkStats {
    return this.disposed ? zeroLink() : this.host.stats();
  }

  /** Subscribe to connection-state transitions; returns an unsubscribe fn. */
  onState(cb: ConnectionStateListener): () => void {
    this.stateListeners.add(cb);
    return () => {
      this.stateListeners.delete(cb);
    };
  }

  /** Subscribe to telemetry events; returns an unsubscribe fn. */
  onTelemetry(cb: ConnectionTelemetryListener): () => void {
    this.telemetryListeners.add(cb);
    return () => {
      this.telemetryListeners.delete(cb);
    };
  }

  /** Drop all subscriptions and dispose the underlying host (terminates worker). */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const unsub of this.hostUnsubs) unsub();
    this.hostUnsubs.length = 0;
    this.stateListeners.clear();
    this.telemetryListeners.clear();
    await this.host.dispose();
  }

  // --- host event handlers ------------------------------------------------

  private onHostState(s: ConnState): void {
    this.currentState = s;
    if (s.kind === 'open') {
      // On the transition to open, ask the vehicle for the default live-ops
      // message set once (T1.11; spec plan/03 §3.3). Guarded so repeated `open`
      // events without an intervening `closed` do not re-request.
      if (this.streams === undefined) {
        this.streams = createStreamRateService({
          send: (name, fields) => this.host.sendMessage(name, fields),
        });
        void this.streams.requestDefaultSet();
      }
    } else if (s.kind === 'closed') {
      // A closed link has no vehicles; clear so the UI does not show stale rows.
      this.currentVehicles = [];
      this.snapshotActiveSysid = undefined;
      this.selectedSysid = undefined;
      this.streams = undefined;
      this.emitTelemetry();
    }
    for (const cb of this.stateListeners) cb(s);
  }

  private onHostTelemetry(t: HostTelemetry): void {
    this.currentVehicles = t.vehicles;
    this.snapshotActiveSysid = t.activeSysid;
    this.emitTelemetry();
  }

  private emitTelemetry(): void {
    const event: ConnectionTelemetry = {
      vehicles: this.currentVehicles,
      activeSysid: this.resolveActiveSysid(),
      stats: this.stats(),
    };
    for (const cb of this.telemetryListeners) cb(event);
  }

  /** User selection wins when it still matches a known vehicle, else most-recent. */
  private resolveActiveSysid(): number | undefined {
    if (
      this.selectedSysid !== undefined &&
      this.currentVehicles.some((v) => v.sysid === this.selectedSysid)
    ) {
      return this.selectedSysid;
    }
    return this.snapshotActiveSysid;
  }
}

/** Construct a {@link ConnectionManager} (ergonomic factory). */
export function createConnectionManager(options: ConnectionManagerOptions): ConnectionManager {
  return new ConnectionManager(options);
}
