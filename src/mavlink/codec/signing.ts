/**
 * MAVLink v2 message signing (spec plan/03 §3.1).
 *
 * A signed frame appends 13 trailing bytes after the CRC:
 *   `link_id(1) | timestamp(6, LE, 48-bit) | signature(6)`
 * where `signature = SHA-256(secret_key[32] || frame[magic..crc] ||
 * link_id || timestamp)` truncated to its first 6 bytes. The timestamp counts
 * 10-microsecond ticks since 2015-01-01T00:00:00 UTC.
 */
import { sha256 } from './sha256';

/** Length of the trailing signature block on a signed v2 frame. */
export const SIGNATURE_LEN = 13;

/** `incompat_flags` bit indicating a frame carries a signature block. */
export const MAVLINK_IFLAG_SIGNED = 0x01;

/** Milliseconds between the Unix epoch and the MAVLink signing epoch (2015-01-01). */
const MAVLINK_EPOCH_MS = Date.UTC(2015, 0, 1);

/**
 * Current MAVLink signing timestamp (10µs ticks since 2015-01-01) for the
 * wall clock. Used as the default outgoing-timestamp source; deterministic
 * timestamps can be injected via the codec factory for conformance tests.
 */
export function signingTimestampNow(): bigint {
  const ms = Date.now() - MAVLINK_EPOCH_MS;
  return BigInt(Math.max(0, Math.trunc(ms * 100)));
}

/** Write a 48-bit little-endian timestamp into `out` at `offset`. */
export function writeTimestamp48(out: Uint8Array, offset: number, ts: bigint): void {
  let v = BigInt.asUintN(48, ts);
  for (let i = 0; i < 6; i++) {
    out[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}

/** Read a 48-bit little-endian timestamp from `bytes` at `offset`. */
export function readTimestamp48(bytes: Uint8Array, offset: number): bigint {
  let v = 0n;
  for (let i = 5; i >= 0; i--) {
    v = (v << 8n) | BigInt(bytes[offset + i] as number);
  }
  return v;
}

/**
 * Compute the 6-byte MAVLink signature for a frame.
 *
 * @param key - 32-byte secret key
 * @param frameThroughCrc - frame bytes from the magic up to and including the CRC
 * @param linkId - link id (0-255)
 * @param ts - 48-bit signing timestamp
 * @returns the 6-byte signature
 */
export function computeSignature(
  key: Uint8Array,
  frameThroughCrc: Uint8Array,
  linkId: number,
  ts: bigint,
): Uint8Array {
  const buf = new Uint8Array(key.length + frameThroughCrc.length + 1 + 6);
  buf.set(key, 0);
  buf.set(frameThroughCrc, key.length);
  let p = key.length + frameThroughCrc.length;
  buf[p++] = linkId & 0xff;
  writeTimestamp48(buf, p, ts);
  return sha256(buf).subarray(0, 6);
}

/**
 * Per-link/source outgoing + incoming signing state. Outgoing timestamps are
 * kept strictly increasing; incoming timestamps can be checked for monotonic
 * progression to reject replays (opt-in).
 */
export class SigningState {
  private lastTx = 0n;
  private readonly lastRx = new Map<string, bigint>();

  /** Next strictly-increasing outgoing timestamp, seeded from `clock`. */
  nextTxTimestamp(clock: bigint): bigint {
    const ts = clock > this.lastTx ? clock : this.lastTx + 1n;
    this.lastTx = ts;
    return ts;
  }

  /**
   * Validate an incoming timestamp for `(linkId, sysid, compid)`.
   *
   * @returns `true` if the timestamp is acceptable (strictly newer, or first
   * seen), `false` if it is a stale/replayed timestamp.
   */
  acceptRxTimestamp(linkId: number, sysid: number, compid: number, ts: bigint): boolean {
    const key = `${linkId}:${sysid}:${compid}`;
    const prev = this.lastRx.get(key);
    if (prev !== undefined && ts <= prev) return false;
    this.lastRx.set(key, ts);
    return true;
  }

  reset(): void {
    this.lastTx = 0n;
    this.lastRx.clear();
  }
}

/** Constant-time-ish equality for the 6 signature bytes. */
export function signaturesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}
