/**
 * WebSocket bridge transport (T1.7; spec plan/03 §3.5 item 4 + §3.6 bridge).
 *
 * Connects the browser to a `ws://` / `wss://` endpoint that proxies a TCP or
 * UDP MAVLink stream — SITL (`tcp:5760`), `mavlink-router`, `mavproxy`, or the
 * optional companion bridge (spec plan/03 §3.6). This is how Firefox/Safari and
 * network/remote links reach a vehicle. It implements the frozen
 * {@link Transport} seam (`src/contracts/transport.ts`) exactly: a duplex byte
 * pipe exposed as a {@link ReadableStream}/{@link WritableStream} pair, a
 * {@link ConnState} channel, and {@link LinkStats} counters.
 *
 * The implementation is pure of DOM and unit-testable: the {@link WebSocket}
 * constructor and the backoff scheduler are injectable (conventions plan/03
 * §0.3), so tests drive a fake socket (`onopen`/`onmessage`/`onclose`) and a
 * manual clock without a real network or browser.
 */

import type { ConnState, LinkStats, Transport, TransportFactory } from '../../contracts';

/** Minimal `MessageEvent` view: only the binary `data` payload is consumed. */
export interface WebSocketMessageEventLike {
  readonly data: unknown;
}

/** Minimal `CloseEvent` view (fields are informational only). */
export interface WebSocketCloseEventLike {
  readonly code?: number;
  readonly reason?: string;
  readonly wasClean?: boolean;
}

/**
 * Structural view of the parts of a `WebSocket` instance this transport uses.
 * The global `WebSocket` satisfies it; tests provide a fake implementing it.
 */
export interface WebSocketLike {
  /** Must be set to `'arraybuffer'` so binary frames arrive as `ArrayBuffer`. */
  binaryType: string;
  onopen: (() => void) | null;
  onmessage: ((ev: WebSocketMessageEventLike) => void) | null;
  onclose: ((ev: WebSocketCloseEventLike) => void) | null;
  onerror: (() => void) | null;
  send(data: ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

/** Constructor shape for an injectable {@link WebSocketLike}. */
export type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocketLike;

/** Validated `open()` configuration: a single `ws://`/`wss://` endpoint URL. */
export interface WebSocketConfig {
  readonly url: string;
}

/**
 * Single-shot backoff scheduler (one pending timer at a time). Injectable so
 * tests can drive reconnect timing deterministically. The default uses
 * `setTimeout`/`clearTimeout`.
 */
export interface Scheduler {
  /** Replace any pending timer with one firing `cb` after `delayMs`. */
  schedule(cb: () => void, delayMs: number): void;
  /** Cancel the pending timer, if any. */
  cancel(): void;
}

/** Tuning + injection points for {@link WebSocketTransport}. */
export interface WebSocketTransportOptions {
  /** `WebSocket` constructor; defaults to the global `WebSocket`. */
  readonly WebSocketCtor?: WebSocketCtor;
  /** First-reconnect backoff delay in ms (default 500). */
  readonly backoffBaseMs?: number;
  /** Upper bound on backoff delay in ms (default 16000). */
  readonly backoffMaxMs?: number;
  /** Backoff scheduler; defaults to a `setTimeout`-based one. */
  readonly scheduler?: Scheduler;
}

/** Default first-reconnect delay (ms). */
const DEFAULT_BACKOFF_BASE_MS = 500;
/** Default backoff ceiling (ms). */
const DEFAULT_BACKOFF_MAX_MS = 16_000;

/**
 * JSON-schema-like descriptor for the connection-drawer form (spec plan/03
 * §3.5 / §3.7). Typed `unknown` at the {@link TransportFactory} seam.
 */
export const WEBSOCKET_CONFIG_SCHEMA = {
  type: 'object',
  required: ['url'],
  properties: {
    url: {
      type: 'string',
      title: 'Bridge URL',
      description:
        'ws:// or wss:// endpoint bridging a MAVLink TCP/UDP stream ' +
        '(e.g. ws://localhost:5760 for SITL via a bridge).',
      format: 'uri',
      pattern: '^wss?://',
    },
  },
  additionalProperties: false,
} as const;

/** Build the default `setTimeout`-based {@link Scheduler}. */
function createDefaultScheduler(): Scheduler {
  let handle: ReturnType<typeof setTimeout> | undefined;
  return {
    schedule(cb, delayMs): void {
      if (handle !== undefined) clearTimeout(handle);
      handle = setTimeout(cb, delayMs);
    },
    cancel(): void {
      if (handle !== undefined) {
        clearTimeout(handle);
        handle = undefined;
      }
    },
  };
}

/** Validate untyped `open()` config into a {@link WebSocketConfig}. */
function parseConfig(config: unknown): WebSocketConfig {
  if (typeof config !== 'object' || config === null) {
    throw new TypeError('websocket transport: config must be an object with a "url"');
  }
  const { url } = config as { url?: unknown };
  if (typeof url !== 'string' || url.length === 0) {
    throw new TypeError('websocket transport: config.url must be a non-empty string');
  }
  if (!/^wss?:\/\//i.test(url)) {
    throw new TypeError('websocket transport: config.url must start with ws:// or wss://');
  }
  return { url };
}

/** Coerce a received frame payload to bytes, or `undefined` for non-binary. */
function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return undefined;
}

/** Normalize an unknown thrown value to an `Error`. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/**
 * WebSocket-bridge {@link Transport}. Construct directly with injected options
 * for tests, or via {@link createWebSocketTransportFactory}.
 */
export class WebSocketTransport implements Transport {
  readonly id = 'websocket';
  readonly capabilities = { duplex: true, reconnect: true } as const;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;

  readonly #ctor: WebSocketCtor | undefined;
  readonly #backoffBaseMs: number;
  readonly #backoffMaxMs: number;
  readonly #scheduler: Scheduler;
  readonly #listeners = new Set<(s: ConnState) => void>();

  #state: ConnState = { kind: 'closed' };
  #config: WebSocketConfig | undefined;
  #socket: WebSocketLike | undefined;
  #readableController: ReadableStreamDefaultController<Uint8Array> | undefined;
  #readableClosed = false;
  #closedByUser = false;
  #pendingOpenReject: ((err: Error) => void) | undefined;
  #attempt = 0;

  #bytesIn = 0;
  #bytesOut = 0;
  #packetsIn = 0;

  constructor(options?: WebSocketTransportOptions) {
    this.#ctor =
      options?.WebSocketCtor ??
      (typeof WebSocket !== 'undefined'
        ? // The global WebSocket satisfies WebSocketLike structurally; the
          // handler event types differ, so cross the boundary explicitly.
          (WebSocket as unknown as WebSocketCtor)
        : undefined);
    this.#backoffBaseMs = options?.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.#backoffMaxMs = options?.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
    this.#scheduler = options?.scheduler ?? createDefaultScheduler();

    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#readableController = controller;
      },
      cancel: () => {
        // Consumer is done reading; the controller is already finished, so
        // mark the readable closed (no further enqueue/close) and tear down.
        this.#readableClosed = true;
        void this.close();
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.#send(chunk);
      },
      abort: () => {
        void this.close();
      },
    });
  }

  /** Open the link. Resolves on first connect; rejects if it never connects. */
  open(config: unknown): Promise<void> {
    if (this.#state.kind !== 'closed') {
      return Promise.reject(new Error('websocket transport: already open'));
    }
    if (this.#readableClosed) {
      return Promise.reject(new Error('transport already consumed; create a new instance'));
    }
    let cfg: WebSocketConfig;
    try {
      cfg = parseConfig(config);
    } catch (err) {
      return Promise.reject(toError(err));
    }
    this.#config = cfg;
    this.#closedByUser = false;
    this.#attempt = 0;
    this.#setState({ kind: 'opening' });
    return new Promise<void>((resolve, reject) => {
      const settleReject = (err: Error): void => {
        if (this.#pendingOpenReject === settleReject) this.#pendingOpenReject = undefined;
        reject(err);
      };
      const settleResolve = (): void => {
        if (this.#pendingOpenReject === settleReject) this.#pendingOpenReject = undefined;
        resolve();
      };
      this.#pendingOpenReject = settleReject;
      this.#startConnect(true, settleResolve, settleReject);
    });
  }

  /** Close the link, cancel any pending reconnect, and stop emitting state. */
  close(): Promise<void> {
    this.#closedByUser = true;
    const pendingOpenReject = this.#pendingOpenReject;
    this.#pendingOpenReject = undefined;
    pendingOpenReject?.(new Error('closed by user'));
    this.#scheduler.cancel();
    const socket = this.#socket;
    this.#socket = undefined;
    if (socket !== undefined) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    // Give a downstream reader/pipe a clean EOF (`done`) instead of hanging.
    this.#closeReadable();
    this.#setState({ kind: 'closed' });
    return Promise.resolve();
  }

  /** Close the readable stream's controller exactly once (idempotent). */
  #closeReadable(): void {
    if (this.#readableClosed) return;
    this.#readableClosed = true;
    this.#readableController?.close();
  }

  /** Subscribe to {@link ConnState}; emits the current state immediately. */
  onState(cb: (s: ConnState) => void): () => void {
    this.#listeners.add(cb);
    cb(this.#state);
    return () => {
      this.#listeners.delete(cb);
    };
  }

  /** Link byte/packet counters. Loss is unknowable here (0); never signed. */
  stats(): LinkStats {
    return {
      bytesIn: this.#bytesIn,
      bytesOut: this.#bytesOut,
      packetsIn: this.#packetsIn,
      lossPct: 0,
      rateHz: 0,
      signed: false,
    };
  }

  /** Open one socket and wire its handlers for the given attempt. */
  #startConnect(initial: boolean, resolve?: () => void, reject?: (e: Error) => void): void {
    const cfg = this.#config;
    const Ctor = this.#ctor;
    if (cfg === undefined || Ctor === undefined) {
      const err = new Error('websocket transport: WebSocket is not supported in this environment');
      if (initial) {
        this.#setState({ kind: 'closed' });
        reject?.(err);
      } else {
        this.#scheduleReconnect();
      }
      return;
    }

    let socket: WebSocketLike;
    try {
      socket = new Ctor(cfg.url);
    } catch (err) {
      if (initial) {
        this.#setState({ kind: 'closed' });
        reject?.(toError(err));
      } else {
        this.#scheduleReconnect();
      }
      return;
    }

    socket.binaryType = 'arraybuffer';
    this.#socket = socket;
    let opened = false;

    socket.onopen = (): void => {
      opened = true;
      this.#attempt = 0;
      this.#setState({ kind: 'open' });
      resolve?.();
    };
    socket.onmessage = (ev): void => {
      this.#onMessage(ev.data);
    };
    socket.onerror = (): void => {
      // The browser fires error immediately before close; let onclose drive
      // recovery. Surface a transient error only while connected/connecting.
      if (this.#state.kind === 'open' || this.#state.kind === 'opening') {
        this.#setState({ kind: 'error', message: `websocket error: ${cfg.url}` });
      }
    };
    socket.onclose = (): void => {
      this.#socket = undefined;
      if (this.#closedByUser) {
        this.#setState({ kind: 'closed' });
        return;
      }
      if (initial && !opened) {
        // Initial connect never succeeded: reject, do not auto-reconnect.
        this.#setState({ kind: 'closed' });
        reject?.(new Error(`websocket transport: failed to connect to ${cfg.url}`));
        return;
      }
      // Unexpected drop (was open) or a failed reconnect attempt: back off.
      this.#scheduleReconnect();
    };
  }

  /** Bump the attempt, emit `reconnecting`, and schedule a bounded backoff. */
  #scheduleReconnect(): void {
    this.#attempt += 1;
    this.#setState({ kind: 'reconnecting', attempt: this.#attempt });
    const delayMs = this.#backoffDelayMs(this.#attempt);
    this.#scheduler.schedule(() => {
      if (this.#closedByUser) return;
      this.#startConnect(false);
    }, delayMs);
  }

  /** Exponential backoff bounded by `backoffMaxMs`. `attempt` is 1-based. */
  #backoffDelayMs(attempt: number): number {
    const exp = this.#backoffBaseMs * 2 ** (attempt - 1);
    return Math.min(exp, this.#backoffMaxMs);
  }

  /** Enqueue an inbound binary frame onto the readable stream. */
  #onMessage(data: unknown): void {
    if (this.#readableClosed) return; // readable already EOF'd
    const bytes = toBytes(data);
    if (bytes === undefined) return; // ignore text/control frames
    this.#bytesIn += bytes.byteLength;
    this.#packetsIn += 1;
    this.#readableController?.enqueue(bytes);
  }

  /**
   * Send outbound bytes to the active socket. MAVLink is loss-tolerant, so a
   * write during a `reconnecting`/`opening` gap is dropped silently rather than
   * thrown: throwing would error the {@link WritableStream} irrecoverably (per
   * WHATWG Streams), permanently killing outbound after a single transient
   * drop. The chunk is not buffered — it is simply discarded until reconnect.
   */
  #send(chunk: Uint8Array): void {
    const socket = this.#socket;
    if (socket === undefined || this.#state.kind !== 'open') {
      return; // not connected: drop this chunk, keep the writable usable
    }
    socket.send(chunk);
    this.#bytesOut += chunk.byteLength;
  }

  /** Record and broadcast a state transition. */
  #setState(state: ConnState): void {
    this.#state = state;
    for (const cb of this.#listeners) cb(state);
  }
}

/**
 * Build a `'websocket'` {@link TransportFactory}. Pass options (e.g. an injected
 * `WebSocketCtor`) for tests; production code uses {@link websocketTransportFactory}.
 */
export function createWebSocketTransportFactory(
  options?: WebSocketTransportOptions,
): TransportFactory {
  return {
    id: 'websocket',
    label: 'WebSocket bridge',
    isSupported: (): boolean => {
      if (options?.WebSocketCtor !== undefined) return true;
      return typeof WebSocket !== 'undefined';
    },
    configSchema: WEBSOCKET_CONFIG_SCHEMA,
    create: (): Transport => new WebSocketTransport(options),
  };
}

/** The default WebSocket-bridge transport factory (real global `WebSocket`). */
export const websocketTransportFactory: TransportFactory = createWebSocketTransportFactory();
