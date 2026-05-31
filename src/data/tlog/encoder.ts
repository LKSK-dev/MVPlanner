/**
 * Pure tlog byte encoding (task T2.10; spec plan/07 §7.4). No I/O, no state — so
 * the wire format is unit-testable in isolation and stays the single source of
 * truth shared by the recorder and verified against `transport/replay`'s
 * `parseTlog`.
 *
 * Each tlog entry is:
 *
 *   [ u64 BIG-ENDIAN timestamp in 100 ns ticks ] [ raw MAVLink frame bytes ]
 *
 * The timestamp is derived from a frame's receive time in MICROSECONDS:
 * `ticks = microseconds * 10` (Mission Planner / pymavlink convention). This is
 * exactly the inverse of `parseTlog`, which reads the big-endian u64 and divides
 * by 10 to recover microseconds.
 */

/** Bytes of the per-entry big-endian u64 timestamp prefix. */
export const TIMESTAMP_BYTES = 8;

/** 100 ns ticks per microsecond (tlog timestamps are in 100 ns units). */
const TICKS_PER_MICROSECOND = 10n;

/** MIME type used for exported tlog blobs. */
export const TLOG_MIME = 'application/octet-stream';

/**
 * Convert a receive time in microseconds to a tlog timestamp in 100 ns ticks.
 * Non-finite or negative inputs clamp to `0n` so a corrupt clock can never
 * produce an unparseable (or wildly out-of-range) entry.
 */
export function microsToTlogTicks(rxTimeUs: number): bigint {
  if (!Number.isFinite(rxTimeUs) || rxTimeUs <= 0) return 0n;
  return BigInt(Math.trunc(rxTimeUs)) * TICKS_PER_MICROSECOND;
}

/**
 * Encode one tlog entry: the 8-byte big-endian timestamp prefix immediately
 * followed by the raw frame bytes. Returns a fresh `Uint8Array` (the input is
 * copied, never retained).
 */
export function encodeTlogEntry(rxTimeUs: number, raw: Uint8Array): Uint8Array {
  const out = new Uint8Array(TIMESTAMP_BYTES + raw.byteLength);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, microsToTlogTicks(rxTimeUs), false); // false = big-endian
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
