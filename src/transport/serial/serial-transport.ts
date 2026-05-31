/**
 * Web Serial {@link Transport} (T1.6; spec plan/03 §3.5 item 1; contract
 * `src/contracts/transport.ts`). Wraps a Web Serial `SerialPort` and exposes its
 * inbound/outbound byte streams behind the frozen transport seam so the MAVLink
 * codec (T1.1) can read/write raw bytes without knowing about serial details.
 *
 * Design notes:
 * - `readable`/`writable` are stable {@link TransformStream} endpoints created
 *   once in the constructor (the contract types them as non-null readonly
 *   streams). On `open` the port's streams are piped through these transforms,
 *   which is also where byte counters are incremented as bytes flow.
 * - Framing is the codec's job, so `packetsIn`/`rateHz`/`lossPct` stay `0` here
 *   and `signed` is `false`; `rssi` is omitted (it comes from `RADIO_STATUS`).
 * - Auto-reconnect on re-plug is intentionally minimal: a `disconnect` event
 *   transitions to `error` and tears down. Re-opening would require re-wiring the
 *   stable stream endpoints (which the frozen seam does not allow to change), so
 *   the connection manager (T1.10) owns any retry; see `README.md`.
 */

import type { ConnState, LinkStats, Transport } from '../../contracts';
import { DEFAULT_BAUD_RATE, type SerialPortLike, type SerialProviderLike } from './types';

/** Injectable dependencies for {@link SerialTransport} (testability seam). */
export interface SerialTransportDeps {
  /** Web Serial provider; defaults to `navigator.serial` at runtime. */
  provider?: SerialProviderLike | undefined;
  /**
   * Port-acquisition hook; defaults to `provider.requestPort()`. Lets tests
   * inject a fake {@link SerialPortLike} without prompting a real chooser.
   */
  requestPort?: ((provider: SerialProviderLike) => Promise<SerialPortLike>) | undefined;
}

/** Mutable byte/packet counters backing {@link SerialTransport.stats}. */
interface MutableStats {
  bytesIn: number;
  bytesOut: number;
  packetsIn: number;
}

/** Web Serial transport implementing the frozen {@link Transport} seam. */
export class SerialTransport implements Transport {
  readonly id = 'serial';
  /** Re-plug auto-reconnect is deferred to the manager (see module doc). */
  readonly capabilities = { duplex: true, reconnect: false } as const;

  readonly #provider: SerialProviderLike | undefined;
  readonly #requestPort: (provider: SerialProviderLike) => Promise<SerialPortLike>;

  readonly #rx: TransformStream<Uint8Array, Uint8Array>;
  readonly #tx: TransformStream<Uint8Array, Uint8Array>;
  readonly #stats: MutableStats = { bytesIn: 0, bytesOut: 0, packetsIn: 0 };
  readonly #listeners = new Set<(s: ConnState) => void>();

  #state: ConnState = { kind: 'closed' };
  #port: SerialPortLike | null = null;
  #rxAbort: AbortController | undefined;
  #txAbort: AbortController | undefined;
  #rxPipe: Promise<void> | undefined;
  #txPipe: Promise<void> | undefined;

  constructor(deps: SerialTransportDeps = {}) {
    this.#provider = deps.provider;
    this.#requestPort = deps.requestPort ?? ((provider) => provider.requestPort());
    this.#rx = new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        this.#stats.bytesIn += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    this.#tx = new TransformStream<Uint8Array, Uint8Array>({
      transform: (chunk, controller) => {
        this.#stats.bytesOut += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
  }

  /** Inbound byte stream consumed by the codec. */
  get readable(): ReadableStream<Uint8Array> {
    return this.#rx.readable;
  }

  /** Outbound byte stream the codec writes encoded frames to. */
  get writable(): WritableStream<Uint8Array> {
    return this.#tx.writable;
  }

  /**
   * Acquire a port (via the injected hook / `navigator.serial`), open it at the
   * configured baud rate, and start pumping bytes both ways.
   *
   * @param config - `{ baudRate?: number }`; defaults to
   *   {@link DEFAULT_BAUD_RATE} (115200) when omitted.
   */
  async open(config: unknown): Promise<void> {
    if (this.#port) {
      throw new Error('serial transport is already open');
    }
    const baudRate = resolveBaudRate(config);
    const provider = this.#provider ?? defaultProvider();
    if (!provider) {
      const message = 'Web Serial is not supported in this environment';
      this.#setState({ kind: 'error', message });
      throw new Error(message);
    }
    this.#setState({ kind: 'opening' });
    try {
      const port = await this.#requestPort(provider);
      await port.open({ baudRate });
      this.#startPumping(port);
      this.#port = port;
      port.addEventListener?.('disconnect', this.#handleDisconnect);
      this.#setState({ kind: 'open' });
    } catch (err) {
      const message = errorMessage(err);
      this.#setState({ kind: 'error', message });
      throw err instanceof Error ? err : new Error(message);
    }
  }

  /** Stop pumping, release the port and its streams, and report `closed`. */
  async close(): Promise<void> {
    const port = this.#port;
    if (!port) {
      if (this.#state.kind !== 'closed') {
        this.#setState({ kind: 'closed' });
      }
      return;
    }
    port.removeEventListener?.('disconnect', this.#handleDisconnect);
    this.#teardownPipes();
    await Promise.allSettled([this.#rxPipe, this.#txPipe]);
    try {
      await port.close();
    } finally {
      this.#reset();
      this.#setState({ kind: 'closed' });
    }
  }

  /** Subscribe to state changes; the current state is delivered immediately. */
  onState(cb: (s: ConnState) => void): () => void {
    this.#listeners.add(cb);
    cb(this.#state);
    return () => {
      this.#listeners.delete(cb);
    };
  }

  /**
   * Link counters. Bytes update as data flows; `packetsIn`/`lossPct`/`rateHz`
   * stay `0` (framing belongs to the codec), `signed` is `false`, and `rssi` is
   * omitted (sourced from `RADIO_STATUS` by the connection manager).
   */
  stats(): LinkStats {
    return {
      bytesIn: this.#stats.bytesIn,
      bytesOut: this.#stats.bytesOut,
      packetsIn: this.#stats.packetsIn,
      lossPct: 0,
      rateHz: 0,
      signed: false,
    };
  }

  /** Wire the open port's streams through the counting transforms. */
  #startPumping(port: SerialPortLike): void {
    const { readable, writable } = port;
    if (!readable || !writable) {
      throw new Error('serial port did not expose duplex byte streams');
    }
    this.#rxAbort = new AbortController();
    this.#txAbort = new AbortController();
    // Inbound: port → rx transform → `this.readable`. On close we cancel the
    // source (releasing the port lock) but keep the consumer side intact.
    this.#rxPipe = readable
      .pipeTo(this.#rx.writable, {
        signal: this.#rxAbort.signal,
        preventAbort: true,
        preventClose: true,
      })
      .catch((err: unknown) => this.#onPipeError(err));
    // Outbound: `this.writable` → tx transform → port. On close we abort the
    // destination (releasing the port lock) but keep the producer side intact.
    this.#txPipe = this.#tx.readable
      .pipeTo(writable, { signal: this.#txAbort.signal, preventCancel: true })
      .catch((err: unknown) => this.#onPipeError(err));
  }

  /** Surface non-abort pipe failures as an `error` state. */
  #onPipeError(err: unknown): void {
    if (isAbortError(err)) {
      return;
    }
    this.#setState({ kind: 'error', message: errorMessage(err) });
  }

  /** Re-plug/unplug handler: tear down and report the lost link as `error`. */
  readonly #handleDisconnect = (): void => {
    if (!this.#port) {
      return;
    }
    this.#port.removeEventListener?.('disconnect', this.#handleDisconnect);
    this.#teardownPipes();
    this.#reset();
    this.#setState({ kind: 'error', message: 'serial port disconnected' });
  };

  /** Abort both pipe loops (idempotent). */
  #teardownPipes(): void {
    this.#rxAbort?.abort();
    this.#txAbort?.abort();
  }

  /** Drop per-connection state so the instance is back to a pre-open shape. */
  #reset(): void {
    this.#port = null;
    this.#rxAbort = undefined;
    this.#txAbort = undefined;
    this.#rxPipe = undefined;
    this.#txPipe = undefined;
  }

  /** Record and broadcast a new connection state. */
  #setState(s: ConnState): void {
    this.#state = s;
    for (const cb of this.#listeners) {
      cb(s);
    }
  }
}

/** Resolve and validate the baud rate from an opaque `open` config. */
function resolveBaudRate(config: unknown): number {
  if (config === undefined || config === null) {
    return DEFAULT_BAUD_RATE;
  }
  if (typeof config !== 'object') {
    throw new Error('serial transport config must be an object');
  }
  const raw = (config as { baudRate?: unknown }).baudRate;
  if (raw === undefined) {
    return DEFAULT_BAUD_RATE;
  }
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw <= 0) {
    throw new Error(`invalid serial baudRate: ${String(raw)}`);
  }
  return raw;
}

/** Read `navigator.serial` defensively (absent in workers / older browsers). */
function defaultProvider(): SerialProviderLike | undefined {
  const nav = (globalThis as { navigator?: { serial?: unknown } }).navigator;
  const serial = nav?.serial;
  if (serial && typeof (serial as { requestPort?: unknown }).requestPort === 'function') {
    return serial as SerialProviderLike;
  }
  return undefined;
}

/** True for the `AbortError` raised by an intentional `pipeTo` abort. */
function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'AbortError'
  );
}

/** Best-effort human-readable message for an unknown thrown value. */
function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
