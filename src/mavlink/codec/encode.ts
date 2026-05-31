/**
 * Frame serialization for MAVLink v1 and v2 (spec plan/03 §3.1–§3.2).
 *
 * v1 frames omit extension fields and never truncate. v2 frames include
 * extension fields and trim trailing zero bytes of the payload (leaving at
 * least one byte). The CRC seeds from {@link MessageMeta.crcExtra}; signed v2
 * frames append the 13-byte signature block.
 */
import type { MessageInput, MessageMeta } from '../../contracts';
import { crcAccumulate, crcAccumulateRange } from './crc';
import { fieldCount, packField, payloadLength } from './field-codec';
import { MAVLINK_IFLAG_SIGNED, SIGNATURE_LEN, computeSignature, writeTimestamp48 } from './signing';

/** Start-of-frame magic for MAVLink v1. */
export const MAGIC_V1 = 0xfe;
/** Start-of-frame magic for MAVLink v2. */
export const MAGIC_V2 = 0xfd;

/** Resolved signing parameters for a single outgoing frame. */
export interface FrameSigning {
  key: Uint8Array;
  linkId: number;
  timestamp: bigint;
}

/** Parameters for {@link encodeFrame}. */
export interface EncodeFrameOptions {
  version: 1 | 2;
  seq: number;
  signing?: FrameSigning;
}

/** Trim trailing zero bytes of a v2 payload, leaving at least one byte. */
function truncatedLength(payload: Uint8Array): number {
  let len = payload.length;
  while (len > 1 && payload[len - 1] === 0) len--;
  return len;
}

/**
 * Serialize a single MAVLink frame for `meta` from `input`.
 *
 * @returns the complete on-the-wire frame (header + payload + CRC, plus the
 * 13 signing bytes for a signed v2 frame)
 */
export function encodeFrame(
  meta: MessageMeta,
  input: MessageInput,
  opts: EncodeFrameOptions,
): Uint8Array {
  const { version, seq } = opts;
  const count = fieldCount(meta, version);
  const fullLen = payloadLength(meta.fields, count);

  const payload = new Uint8Array(fullLen);
  const pdv = new DataView(payload.buffer);
  let off = 0;
  for (let i = 0; i < count; i++) {
    const field = meta.fields[i];
    if (field === undefined) break;
    off = packField(pdv, off, field, input.fields[field.name]);
  }

  const payloadLen = version === 2 ? truncatedLength(payload) : fullLen;
  const headerLen = version === 2 ? 10 : 6;
  const signing = version === 2 ? opts.signing : undefined;
  const sigLen = signing ? SIGNATURE_LEN : 0;
  const frame = new Uint8Array(headerLen + payloadLen + 2 + sigLen);

  if (version === 2) {
    frame[0] = MAGIC_V2;
    frame[1] = payloadLen;
    frame[2] = signing ? MAVLINK_IFLAG_SIGNED : 0;
    frame[3] = 0; // compat_flags
    frame[4] = seq & 0xff;
    frame[5] = input.sysid & 0xff;
    frame[6] = input.compid & 0xff;
    frame[7] = meta.id & 0xff;
    frame[8] = (meta.id >> 8) & 0xff;
    frame[9] = (meta.id >> 16) & 0xff;
  } else {
    frame[0] = MAGIC_V1;
    frame[1] = payloadLen;
    frame[2] = seq & 0xff;
    frame[3] = input.sysid & 0xff;
    frame[4] = input.compid & 0xff;
    frame[5] = meta.id & 0xff;
  }
  frame.set(payload.subarray(0, payloadLen), headerLen);

  const crcEnd = headerLen + payloadLen;
  let crc = crcAccumulateRange(frame, 1, crcEnd);
  crc = crcAccumulate(meta.crcExtra & 0xff, crc);
  frame[crcEnd] = crc & 0xff;
  frame[crcEnd + 1] = (crc >> 8) & 0xff;

  if (signing) {
    const sigStart = crcEnd + 2;
    frame[sigStart] = signing.linkId & 0xff;
    writeTimestamp48(frame, sigStart + 1, signing.timestamp);
    const sig = computeSignature(
      signing.key,
      frame.subarray(0, sigStart),
      signing.linkId,
      signing.timestamp,
    );
    frame.set(sig, sigStart + 7);
  }

  return frame;
}
