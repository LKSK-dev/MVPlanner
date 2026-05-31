/**
 * Internal wire protocol for {@link ../rpc!PostMessageRpc}. These envelopes are
 * exchanged over a `postMessage` endpoint and are NOT part of the frozen
 * `src/contracts/bus.ts` seam — they are an implementation detail of this
 * module (impl 02 §2.1/§2.3).
 *
 * The discriminant `t` keeps frames compact; `id` correlates a caller request
 * with its responses across the boundary.
 */

/** Correlation id for a single in-flight call or stream. */
export type RpcId = number;

/** Serializable representation of a thrown error across the boundary. */
export interface MarshaledError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

/** Caller → handler: start a call (`stream: false`) or stream (`stream: true`). */
export interface RpcRequest {
  readonly t: 'req';
  readonly id: RpcId;
  readonly method: string;
  readonly stream: boolean;
  readonly req: unknown;
}

/** Caller → handler: cancel an in-flight call/stream (AbortSignal fired). */
export interface RpcCancel {
  readonly t: 'cancel';
  readonly id: RpcId;
}

/** Handler → caller: successful single response to a `call`. */
export interface RpcResult {
  readonly t: 'res';
  readonly id: RpcId;
  readonly res: unknown;
}

/** Handler → caller: one streamed message. */
export interface RpcStreamMsg {
  readonly t: 'msg';
  readonly id: RpcId;
  readonly msg: unknown;
}

/** Handler → caller: stream completed normally. */
export interface RpcStreamEnd {
  readonly t: 'end';
  readonly id: RpcId;
}

/** Handler → caller: the call/stream failed; carries a marshaled error. */
export interface RpcFailure {
  readonly t: 'err';
  readonly id: RpcId;
  readonly error: MarshaledError;
}

/** Union of every frame on the wire. */
export type RpcEnvelope =
  | RpcRequest
  | RpcCancel
  | RpcResult
  | RpcStreamMsg
  | RpcStreamEnd
  | RpcFailure;

const ENVELOPE_KINDS: ReadonlySet<string> = new Set(['req', 'cancel', 'res', 'msg', 'end', 'err']);

/**
 * Narrow an untrusted `postMessage` payload to an {@link RpcEnvelope}. Foreign
 * messages sharing the same endpoint are ignored rather than throwing.
 */
export function isRpcEnvelope(value: unknown): value is RpcEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const rec = value as Record<string, unknown>;
  return typeof rec.t === 'string' && ENVELOPE_KINDS.has(rec.t) && typeof rec.id === 'number';
}

/** Convert any thrown value into a serializable {@link MarshaledError}. */
export function marshalError(err: unknown): MarshaledError {
  if (err instanceof Error) {
    const out: MarshaledError = { name: err.name, message: err.message };
    // Respect exactOptionalPropertyTypes: only attach `stack` when present.
    return err.stack === undefined ? out : { ...out, stack: err.stack };
  }
  return { name: 'Error', message: typeof err === 'string' ? err : String(err) };
}

/** Reconstruct an {@link Error} on the caller side from a {@link MarshaledError}. */
export function unmarshalError(m: MarshaledError): Error {
  const err = new Error(m.message);
  err.name = m.name;
  if (m.stack !== undefined) err.stack = m.stack;
  return err;
}
