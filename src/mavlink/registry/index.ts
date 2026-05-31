/**
 * MAVLink message registry public surface (task T1.4; spec plan/03 §3.3).
 *
 * An INTERNAL module (no frozen contract to implement) that ingests
 * {@link DecodedMessage}s and answers inspector/UI queries: latest message,
 * observed rate, last-seen, bounded recent-frame ring, per-`(sysid, compid)`
 * sequence-gap / packet-loss stats, and name↔id resolution.
 *
 * @see ./README.md for the contract, owned files, and how to test.
 */
export { MessageRegistry } from './registry';
export { createDialectResolver } from './resolver';
export { RingBuffer } from './ring';
export { SlidingWindowRate } from './rate';
export { LinkLossTracker } from './loss';
export type {
  IdNameResolver,
  LinkStats,
  MessageRecord,
  MessageRegistryOptions,
  SystemKey,
} from './types';
