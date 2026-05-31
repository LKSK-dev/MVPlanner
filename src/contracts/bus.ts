/**
 * Event bus + worker RPC seams (impl 02 §2.1; spec plan/02 §2.1/§2.3).
 * FROZEN — change only via the contract change-control rule (impl 00 §0.6).
 */

export interface EventBus {
  on<T>(topic: string, cb: (payload: T) => void): () => void;
  emit<T>(topic: string, payload: T): void;
}

/** Request/response + streaming RPC over postMessage (main <-> worker). */
export interface Rpc {
  call<Req, Res>(method: string, req: Req, opts?: { signal?: AbortSignal }): Promise<Res>;
  handle<Req, Res>(method: string, fn: (req: Req, signal: AbortSignal) => Promise<Res>): void;
  stream<Req, Msg>(
    method: string,
    req: Req,
    onMsg: (m: Msg) => void,
    opts?: { signal?: AbortSignal },
  ): Promise<void>;
  /**
   * Server counterpart to {@link Rpc.stream}: register a streaming handler for
   * `method`. `fn` calls `send(msg)` for each message and resolves to end the
   * stream; throwing surfaces as a rejection on the caller's `stream` promise.
   * `signal` aborts when the caller cancels. (Added in CONTRACTS_VERSION 1.1.0 —
   * `stream` is non-functional without a handler counterpart.)
   */
  handleStream<Req, Msg>(
    method: string,
    fn: (req: Req, send: (msg: Msg) => void, signal: AbortSignal) => Promise<void>,
  ): void;
}
