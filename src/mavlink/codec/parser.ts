/**
 * Streaming, resync-safe MAVLink parser (spec plan/03 §3.2).
 *
 * `push` buffers bytes across calls, locates frames by magic, validates the
 * CRC (with the per-message `crcExtra`), optionally verifies v2 signatures, and
 * never throws on garbage: on a bad magic, short frame, CRC mismatch, failed
 * signature, or a v2 frame carrying an unknown `incompat_flags` bit it advances
 * a single byte and resynchronises. With signing enabled, unsigned frames are
 * rejected unless `allowUnsigned === true` is set explicitly (secure default;
 * see {@link unsignedAllowed}). v2 truncated payloads are zero-filled back to
 * their full field set before unpacking.
 */
import type {
  DecodedMessage,
  DialectTable,
  FieldValue,
  MavParser,
  MessageMeta,
  SigningConfig,
} from '../../contracts';
import { crcAccumulate, crcAccumulateRange } from './crc';
import { fieldCount, payloadLength, unpackField } from './field-codec';
import { MAGIC_V1, MAGIC_V2 } from './encode';
import {
  MAVLINK_IFLAG_SIGNED,
  SIGNATURE_LEN,
  SigningState,
  computeSignature,
  readTimestamp48,
  signaturesEqual,
  unsignedAllowed,
} from './signing';

const V1_HEADER = 6;
const V2_HEADER = 10;

/** Extra (beyond the frozen {@link SigningConfig}) parser knobs. */
export interface ParserExtras {
  /** Reject replayed/stale timestamps per (link, sysid, compid). Default false. */
  enforceTimestampMonotonic?: boolean;
}

function rxTimeUs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return Math.trunc(performance.now() * 1000);
  }
  return 0;
}

function buildIndex(dialects: readonly DialectTable[]): Map<number, MessageMeta> {
  const index = new Map<number, MessageMeta>();
  for (const dialect of dialects) {
    for (const meta of Object.values(dialect.messages)) {
      if (!index.has(meta.id)) index.set(meta.id, meta);
    }
  }
  return index;
}

/** Concrete streaming parser backing {@link MavParser}. */
export class StreamingParser implements MavParser {
  private readonly index: Map<number, MessageMeta>;
  private readonly signing: SigningConfig | undefined;
  private readonly enforceMonotonic: boolean;
  private readonly signingState = new SigningState();
  private buf = new Uint8Array(0);

  constructor(dialects: readonly DialectTable[], signing?: SigningConfig, extras?: ParserExtras) {
    this.index = buildIndex(dialects);
    this.signing = signing;
    this.enforceMonotonic = extras?.enforceTimestampMonotonic ?? false;
  }

  reset(): void {
    this.buf = new Uint8Array(0);
    this.signingState.reset();
  }

  push(bytes: Uint8Array): DecodedMessage[] {
    const out: DecodedMessage[] = [];
    // Append the new bytes to whatever partial frame remained.
    if (this.buf.length === 0) {
      this.buf = bytes.slice();
    } else {
      const merged = new Uint8Array(this.buf.length + bytes.length);
      merged.set(this.buf, 0);
      merged.set(bytes, this.buf.length);
      this.buf = merged;
    }

    const buf = this.buf;
    let i = 0;
    // Earliest position holding a candidate frame that is not yet fully present.
    // We may *skip past* such a candidate to look for a later, complete and
    // CRC-valid frame (a complete valid frame cannot legitimately overlap an
    // earlier real frame, so finding one proves the earlier magic was garbage).
    // If no complete frame is found, we retain the buffer from `waitPos` so the
    // partial frame can complete on the next push.
    let waitPos = -1;
    while (i < buf.length) {
      const magic = buf[i] as number;
      if (magic !== MAGIC_V1 && magic !== MAGIC_V2) {
        i++;
        continue;
      }

      const isV2 = magic === MAGIC_V2;
      const headerLen = isV2 ? V2_HEADER : V1_HEADER;
      // Need at least the length byte (and incompat flags for v2) to size the frame.
      const minHeader = isV2 ? 3 : 2;
      if (buf.length - i < minHeader) {
        if (waitPos < 0) waitPos = i;
        break;
      }

      const payloadLen = buf[i + 1] as number;
      const incompat = isV2 ? (buf[i + 2] as number) : 0;
      // An unknown incompat_flags bit (anything but SIGNED) means the frame
      // cannot be safely interpreted (spec plan/03 §3.2): drop it and resync.
      // compat_flags are advisory and remain ignored.
      if ((incompat & ~MAVLINK_IFLAG_SIGNED) !== 0) {
        i++;
        continue;
      }
      const signed = isV2 && (incompat & MAVLINK_IFLAG_SIGNED) !== 0;
      const frameLen = headerLen + payloadLen + 2 + (signed ? SIGNATURE_LEN : 0);
      if (buf.length - i < frameLen) {
        // Incomplete: remember it but keep scanning for a later complete frame.
        if (waitPos < 0) waitPos = i;
        i++;
        continue;
      }

      const msg = this.tryDecode(buf, i, frameLen, isV2, payloadLen, signed);
      if (msg) {
        out.push(msg);
        i += frameLen;
        waitPos = -1; // consumed up to here; any earlier partial was garbage
      } else {
        i++; // resync
      }
    }

    const retain = waitPos >= 0 ? waitPos : i;
    this.buf = retain >= buf.length ? new Uint8Array(0) : buf.subarray(retain).slice();
    return out;
  }

  private tryDecode(
    buf: Uint8Array,
    start: number,
    frameLen: number,
    isV2: boolean,
    payloadLen: number,
    signed: boolean,
  ): DecodedMessage | null {
    const headerLen = isV2 ? V2_HEADER : V1_HEADER;
    const msgId = isV2
      ? (buf[start + 7] as number) |
        ((buf[start + 8] as number) << 8) |
        ((buf[start + 9] as number) << 16)
      : (buf[start + 5] as number);

    const meta = this.index.get(msgId);
    if (meta === undefined) return null; // unknown id: cannot CRC-verify, resync

    const crcEnd = start + headerLen + payloadLen;
    let crc = crcAccumulateRange(buf, start + 1, crcEnd);
    crc = crcAccumulate(meta.crcExtra & 0xff, crc);
    const frameCrc = (buf[crcEnd] as number) | ((buf[crcEnd + 1] as number) << 8);
    if (crc !== frameCrc) return null;

    const version: 1 | 2 = isV2 ? 2 : 1;
    let isSigned = false;
    let linkId: number | undefined;

    if (signed) {
      const sigStart = crcEnd + 2;
      linkId = buf[sigStart] as number;
      const ts = readTimestamp48(buf, sigStart + 1);
      const frameSig = buf.subarray(sigStart + 7, sigStart + 13);

      if (this.signing?.enabled && this.signing.key) {
        const expected = computeSignature(
          this.signing.key,
          buf.subarray(start, sigStart),
          linkId,
          ts,
        );
        if (!signaturesEqual(expected, frameSig)) return null;
        if (
          this.enforceMonotonic &&
          !this.signingState.acceptRxTimestamp(
            linkId,
            buf[start + 5] as number,
            buf[start + 6] as number,
            ts,
          )
        ) {
          return null;
        }
        isSigned = true;
      }
    } else if (!unsignedAllowed(this.signing)) {
      return null; // signing enabled: unsigned frames rejected unless allowUnsigned === true
    }

    const count = fieldCount(meta, version);
    const neededLen = payloadLength(meta.fields, count);
    const work = new Uint8Array(neededLen);
    work.set(buf.subarray(start + headerLen, start + headerLen + Math.min(payloadLen, neededLen)));
    const wdv = new DataView(work.buffer);

    const fields: Record<string, FieldValue> = {};
    let off = 0;
    for (let f = 0; f < count; f++) {
      const field = meta.fields[f];
      if (field === undefined) break;
      const { value, next } = unpackField(wdv, off, field);
      fields[field.name] = value;
      off = next;
    }

    const sysid = isV2 ? (buf[start + 5] as number) : (buf[start + 3] as number);
    const compid = isV2 ? (buf[start + 6] as number) : (buf[start + 4] as number);
    const seq = isV2 ? (buf[start + 4] as number) : (buf[start + 2] as number);

    const message: DecodedMessage = {
      sysid,
      compid,
      seq,
      msgId,
      name: meta.name,
      fields,
      crcOk: true,
      signed: isSigned,
      rxTimeUs: rxTimeUs(),
      raw: buf.subarray(start, start + frameLen).slice(),
    };
    if (linkId !== undefined) message.linkId = linkId;
    return message;
  }
}
