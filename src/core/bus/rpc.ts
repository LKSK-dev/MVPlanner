/**
 * postMessage request/response + streaming RPC (contract `src/contracts/bus.ts`
 * `Rpc`; impl 02 §2.1/§2.3). Wraps any `{ postMessage, onmessage }` endpoint —
 * a `Worker`, a `MessagePort`, or a `DedicatedWorkerGlobalScope` — so the same
 * code runs on either side of the boundary and is unit-testable over a
 * `MessageChannel`.
 *
 * Beyond the frozen `Rpc` surface (`call`/`handle`/`stream`) this class adds
 * {@link PostMessageRpc.handleStream} (the server counterpart required to make
 * `stream` functional, since the frozen seam only declares a caller-side
 * `stream`) and {@link PostMessageRpc.dispose} for leak-free teardown. Adding
 * members to the implementing class is not a contract change.
 */
import type { Rpc } from '../../contracts';
import {
  isRpcEnvelope,
  marshalError,
  unmarshalError,
  type RpcCancel,
  type RpcEnvelope,
  type RpcFailure,
  type RpcId,
  type RpcRequest,
  type RpcResult,
  type RpcStreamEnd,
  type RpcStreamMsg,
} from './protocol';

/**
 * Minimal structural shape of a message endpoint. `Worker`, `MessagePort`, and
 * `DedicatedWorkerGlobalScope` all satisfy it. Payloads cross as `unknown` and
 * are narrowed on receipt (audited postMessage boundary, impl 00 §0.3).
 */
export interface MessageEndpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  onmessage: ((ev: MessageEvent) => void) | null;
  /** Optional — `MessagePort` needs starting; setting `onmessage` also starts it. */
  start?: () => void;
}

/** Server-side handler for a single request/response method. */
type CallHandler = (req: unknown, signal: AbortSignal) => Promise<unknown>;
/** Server-side handler for a streaming method; `send` emits one message. */
type StreamHandler = (
  req: unknown,
  send: (msg: unknown) => void,
  signal: AbortSignal,
) => Promise<void>;

interface PendingCall {
  resolve(value: unknown): void;
  reject(reason: unknown): void;
}

interface PendingStream {
  onMsg(msg: unknown): void;
  resolve(): void;
  reject(reason: unknown): void;
}

/** {@link Rpc} implementation over a {@link MessageEndpoint}. */
export class PostMessageRpc implements Rpc {
  private readonly endpoint: MessageEndpoint;
  private nextId: RpcId = 1;
  private readonly callHandlers = new Map<string, CallHandler>();
  private readonly streamHandlers = new Map<string, StreamHandler>();
  private readonly calls = new Map<RpcId, PendingCall>();
  private readonly streams = new Map<RpcId, PendingStream>();
  /** Handler-side abort controllers, keyed by inbound request id. */
  private readonly inbound = new Map<RpcId, AbortController>();
  private disposed = false;

  constructor(endpoint: MessageEndpoint) {
    this.endpoint = endpoint;
    endpoint.onmessage = (ev: MessageEvent): void => {
      this.dispatch(ev.data as unknown);
    };
    endpoint.start?.();
  }

  // --- Caller side --------------------------------------------------------

  /** Invoke `method` on the peer and resolve with its single response. */
  call<Req, Res>(method: string, req: Req, opts?: { signal?: AbortSignal }): Promise<Res> {
    const signal = opts?.signal;
    return new Promise<Res>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const id = this.nextId++;
      let onAbort: (() => void) | undefined;
      const finish = (): void => {
        this.calls.delete(id);
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      };
      this.calls.set(id, {
        resolve: (value): void => {
          finish();
          resolve(value as Res);
        },
        reject: (reason): void => {
          finish();
          reject(reason);
        },
      });
      if (signal) {
        onAbort = (): void => {
          const pending = this.calls.get(id);
          if (!pending) return;
          this.post({ t: 'cancel', id });
          pending.reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.post({ t: 'req', id, method, stream: false, req });
    });
  }

  /**
   * Invoke a streaming `method`; `onMsg` is called for each message. The
   * returned promise resolves when the stream ends, rejects on a handler error,
   * and rejects with the abort reason if `opts.signal` fires.
   */
  stream<Req, Msg>(
    method: string,
    req: Req,
    onMsg: (m: Msg) => void,
    opts?: { signal?: AbortSignal },
  ): Promise<void> {
    const signal = opts?.signal;
    return new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const id = this.nextId++;
      let onAbort: (() => void) | undefined;
      const finish = (): void => {
        this.streams.delete(id);
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      };
      this.streams.set(id, {
        onMsg: (msg): void => onMsg(msg as Msg),
        resolve: (): void => {
          finish();
          resolve();
        },
        reject: (reason): void => {
          finish();
          reject(reason);
        },
      });
      if (signal) {
        onAbort = (): void => {
          const pending = this.streams.get(id);
          if (!pending) return;
          this.post({ t: 'cancel', id });
          pending.reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.post({ t: 'req', id, method, stream: true, req });
    });
  }

  // --- Handler side -------------------------------------------------------

  /** Register a request/response handler for `method`. */
  handle<Req, Res>(method: string, fn: (req: Req, signal: AbortSignal) => Promise<Res>): void {
    this.callHandlers.set(method, fn as CallHandler);
  }

  /**
   * Register a streaming handler for `method`. `fn` calls `send(msg)` for each
   * message and resolves to end the stream; throwing surfaces as a rejection on
   * the caller's `stream` promise. `signal` aborts when the caller cancels.
   */
  handleStream<Req, Msg>(
    method: string,
    fn: (req: Req, send: (msg: Msg) => void, signal: AbortSignal) => Promise<void>,
  ): void {
    this.streamHandlers.set(method, fn as StreamHandler);
  }

  /** Reject all in-flight work, detach the endpoint, and drop registrations. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.endpoint.onmessage = null;
    const disposalError = new Error('Rpc disposed');
    for (const pending of [...this.calls.values()]) pending.reject(disposalError);
    for (const pending of [...this.streams.values()]) pending.reject(disposalError);
    this.calls.clear();
    this.streams.clear();
    for (const controller of this.inbound.values()) controller.abort();
    this.inbound.clear();
    this.callHandlers.clear();
    this.streamHandlers.clear();
  }

  // --- Internals ----------------------------------------------------------

  private post(env: RpcEnvelope): void {
    if (this.disposed) return;
    this.endpoint.postMessage(env);
  }

  private dispatch(data: unknown): void {
    if (this.disposed || !isRpcEnvelope(data)) return;
    switch (data.t) {
      case 'req':
        this.onRequest(data);
        break;
      case 'cancel':
        this.onCancel(data);
        break;
      case 'res':
        this.onResult(data);
        break;
      case 'msg':
        this.onStreamMsg(data);
        break;
      case 'end':
        this.onStreamEnd(data);
        break;
      case 'err':
        this.onFailure(data);
        break;
    }
  }

  private onRequest(msg: RpcRequest): void {
    const controller = new AbortController();
    this.inbound.set(msg.id, controller);
    const { signal } = controller;

    if (msg.stream) {
      const handler = this.streamHandlers.get(msg.method);
      if (!handler) {
        this.failInbound(msg.id, new Error(`No stream handler for "${msg.method}"`));
        return;
      }
      const send = (m: unknown): void => {
        if (signal.aborted) return;
        this.post({ t: 'msg', id: msg.id, msg: m });
      };
      void handler(msg.req, send, signal).then(
        () => {
          if (!signal.aborted) this.post({ t: 'end', id: msg.id });
          this.inbound.delete(msg.id);
        },
        (err: unknown) => {
          if (!signal.aborted) this.post({ t: 'err', id: msg.id, error: marshalError(err) });
          this.inbound.delete(msg.id);
        },
      );
      return;
    }

    const handler = this.callHandlers.get(msg.method);
    if (!handler) {
      this.failInbound(msg.id, new Error(`No handler for "${msg.method}"`));
      return;
    }
    void handler(msg.req, signal).then(
      (res) => {
        if (!signal.aborted) this.post({ t: 'res', id: msg.id, res });
        this.inbound.delete(msg.id);
      },
      (err: unknown) => {
        if (!signal.aborted) this.post({ t: 'err', id: msg.id, error: marshalError(err) });
        this.inbound.delete(msg.id);
      },
    );
  }

  private failInbound(id: RpcId, err: unknown): void {
    this.inbound.delete(id);
    this.post({ t: 'err', id, error: marshalError(err) });
  }

  private onCancel(msg: RpcCancel): void {
    const controller = this.inbound.get(msg.id);
    if (!controller) return;
    this.inbound.delete(msg.id);
    controller.abort();
  }

  private onResult(msg: RpcResult): void {
    this.calls.get(msg.id)?.resolve(msg.res);
  }

  private onStreamMsg(msg: RpcStreamMsg): void {
    this.streams.get(msg.id)?.onMsg(msg.msg);
  }

  private onStreamEnd(msg: RpcStreamEnd): void {
    this.streams.get(msg.id)?.resolve();
  }

  private onFailure(msg: RpcFailure): void {
    const err = unmarshalError(msg.error);
    const call = this.calls.get(msg.id);
    if (call) {
      call.reject(err);
      return;
    }
    this.streams.get(msg.id)?.reject(err);
  }
}

/** Create a {@link PostMessageRpc} bound to `endpoint`. */
export function createRpc(endpoint: MessageEndpoint): PostMessageRpc {
  return new PostMessageRpc(endpoint);
}
