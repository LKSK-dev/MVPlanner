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
}
