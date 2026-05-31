/**
 * Public surface of the event bus + worker RPC module (T0.4; contract
 * `src/contracts/bus.ts`). Cross-module consumers import from here, never deep
 * paths (impl 00 §0.3).
 */
export { createEventBus, TypedEventBus } from './event-bus';
export { createRpc, PostMessageRpc, type MessageEndpoint } from './rpc';
export type { MarshaledError } from './protocol';
export type { EventBus, Rpc } from '../../contracts';
