/**
 * Public types for the MAVLink message registry (task T1.4; spec plan/03 §3.3).
 *
 * The registry is an INTERNAL module: it consumes the FROZEN
 * {@link DecodedMessage} type (spec plan/03 §3.2) and exposes query data for the
 * inspector / vehicle model. It implements no frozen contract interface.
 */
import type { DecodedMessage } from '../../contracts';

/**
 * Decoupling seam for name↔id translation. The registry can resolve names from
 * the messages it has already observed; an injected resolver (e.g. one built
 * from dialect tables, see {@link createDialectResolver}) augments that with
 * names/ids that have not yet appeared on the wire.
 */
export interface IdNameResolver {
  /** Numeric message id for a MAVLink message name, or `undefined`. */
  idOf(name: string): number | undefined;
  /** MAVLink message name for a numeric id, or `undefined`. */
  nameOf(id: number): string | undefined;
}

/** Inspector-facing view of one `(sysid, compid, msgId)` stream. */
export interface MessageRecord {
  sysid: number;
  compid: number;
  msgId: number;
  name: string;
  /** Most recently decoded message for this stream. */
  latest: DecodedMessage;
  /** Observed rate in Hz over the recent sliding window (0 until ≥2 samples). */
  rateHz: number;
  /** Timestamp (ms, registry clock domain) of the most recent message. */
  lastSeenMs: number;
  /** Total messages ingested for this stream. */
  count: number;
  /** Bounded ring of the most recent frames (oldest → newest) for the inspector. */
  ring: readonly DecodedMessage[];
}

/** Per-`(sysid, compid)` sequence-gap / packet-loss accounting (spec §3.2). */
export interface LinkStats {
  sysid: number;
  compid: number;
  /** Messages ingested from this source (includes duplicates / reordered). */
  received: number;
  /** Estimated missing messages from sequence gaps. */
  lost: number;
  /** `lost / (received + lost) * 100`, or 0 when nothing seen. */
  lossPct: number;
  /** Messages whose seq equalled the previous seq. */
  duplicates: number;
  /** Messages whose seq moved backwards (reordered / late). */
  outOfOrder: number;
  /** Last (highest, wrap-aware) sequence number observed, or -1 if none. */
  lastSeq: number;
}

/** Identifies a `(sysid, compid)` source on a link. */
export interface SystemKey {
  sysid: number;
  compid: number;
}

/** Construction options for {@link MessageRegistry}. */
export interface MessageRegistryOptions {
  /** Optional name↔id resolver layered over observed messages. */
  resolver?: IdNameResolver;
  /** Per-stream ring-buffer capacity for the inspector (default 20). */
  ringCapacity?: number;
  /** Sliding-window length, in ms, for rate estimation (default 2000). */
  rateWindowMs?: number;
  /** Hard cap on samples retained per stream for rate estimation (default 64). */
  rateMaxSamples?: number;
  /** Time source used when `ingest` is called without an explicit `nowMs`. */
  clock?: () => number;
}
