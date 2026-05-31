/**
 * Thin helpers to bind an {@link Rpc} to a worker endpoint (impl 02 §2.1/§2.6).
 * The transport-agnostic core lives in `src/core/bus`; these wrappers just name
 * the two common call sites so worker hosts read clearly.
 */
import { createRpc, type MessageEndpoint } from '../core/bus';
import type { Rpc } from '../contracts';

/**
 * Main-thread side: bind an {@link Rpc} to a spawned `Worker` (or any
 * `{ postMessage, onmessage }` endpoint such as a `MessagePort`).
 */
export function connectWorker(endpoint: MessageEndpoint): Rpc {
  return createRpc(endpoint);
}

/**
 * Worker side: bind an {@link Rpc} to the worker's own global scope. Pass
 * `self` (typed as a {@link MessageEndpoint}) from inside the worker module.
 */
export function serveWorker(scope: MessageEndpoint): Rpc {
  return createRpc(scope);
}
