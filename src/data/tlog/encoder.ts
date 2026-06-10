/**
 * Pure tlog byte encoding (task T2.10; spec plan/07 §7.4). No I/O, no state — so
 * the wire format is unit-testable in isolation and stays the single source of
 * truth shared by the recorder and verified against `transport/replay`'s
 * `parseTlog`.
 *
 * Each tlog entry is:
 *
 *   [ u64 BIG-ENDIAN timestamp in microseconds since Unix epoch ] [ raw MAVLink frame bytes ]
 *
 * Mission Planner and pymavlink store the timestamp as raw microseconds. The
 * encoder therefore writes the receive timestamp directly after truncating it
 * to an integer and clamping invalid clocks to zero.
 */

/** Bytes of the per-entry big-endian u64 timestamp prefix. */
export const TIMESTAMP_BYTES = 8;

/** MIME type used for exported tlog blobs. */
export const TLOG_MIME = 'application/octet-stream';

/**
 * Convert a receive time in microseconds to a tlog timestamp in microseconds.
 * Non-finite or negative inputs clamp to `0n` so a corrupt clock can never
 * produce an unparseable (or wildly out-of-range) entry.
 */
export function microsToTlogTimestamp(rxTimeUs: number): bigint {
  if (!Number.isFinite(rxTimeUs) || rxTimeUs <= 0) return 0n;
  return BigInt(Math.trunc(rxTimeUs));
}

/**
 * Compatibility alias for callers that imported the old helper name. The tlog
 * timestamp value is microseconds, not a scaled tick unit.
 *
 * @deprecated Use {@link microsToTlogTimestamp}.
 */
export const microsToTlogTicks = microsToTlogTimestamp;

/**
 * Encode one tlog entry: the 8-byte big-endian timestamp prefix immediately
 * followed by the raw frame bytes. Returns a fresh `Uint8Array` (the input is
 * copied, never retained).
 */
export function encodeTlogEntry(rxTimeUs: number, raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(TIMESTAMP_BYTES + raw.byteLength);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, microsToTlogTimestamp(rxTimeUs), false); // false = big-endian
  out.set(raw, TIMESTAMP_BYTES);
  return out;
}

/** Concatenate byte chunks into a single fresh `Uint8Array`. */
export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}
