/**
 * tlog parser (spec plan/07 §7.4).
 *
 * A tlog is a flat byte stream of consecutive entries. Each entry is:
 *
 *   [ u64 big-endian timestamp in microseconds since Unix epoch ] [ raw MAVLink frame bytes ]
 *
 * appended in receive order (Mission Planner / pymavlink compatible). To split
 * entries we must know each frame's exact byte length, which we derive from the
 * MAVLink magic + length byte rather than by re-running the codec.
 *
 * Compatibility note: MVPlanner builds before this parser fix recorded the
 * timestamp as 100 ns ticks. Those legacy self-recorded files are not
 * auto-detected; they will replay with 10× larger intervals because the parser
 * now follows the Mission Planner / pymavlink microsecond convention.
 *
 * Frame sizing (canonical MAVLink framing; the §7.4 task formula's trailing
 * "+2" is the 2-byte CRC already folded into the overhead constants below):
 *   - v1 (0xFE): 6 header + payloadLen + 2 CRC          = payloadLen + 8
 *   - v2 (0xFD): 10 header + payloadLen + 2 CRC          = payloadLen + 12
 *     + 13 signature bytes when INCOMPAT flag 0x01 (signed) is set.
 */

/** Bytes of the per-entry big-endian u64 timestamp prefix. */
const TIMESTAMP_BYTES = 8;

/** MAVLink v1 start-of-frame magic. */
const MAVLINK_V1_STX = 0xfe;
/** MAVLink v2 start-of-frame magic. */
const MAVLINK_V2_STX = 0xfd;

/** v1 non-payload overhead: 6 header + 2 CRC. */
const V1_OVERHEAD = 8;
/** v2 non-payload overhead: 10 header + 2 CRC. */
const V2_OVERHEAD = 12;
/** v2 trailing signature block length when the frame is signed. */
const V2_SIGNATURE_BYTES = 13;
/** v2 INCOMPAT_FLAG that marks a signed frame. */
const MAVLINK_IFLAG_SIGNED = 0x01;

/** One parsed tlog entry: a timestamp plus the raw MAVLink frame it prefixed. */
export interface TlogFrame {
  /** Raw timestamp as stored in the tlog (microseconds since Unix epoch). */
  readonly timeTicks: bigint;
  /**
   * Playback time of this frame in microseconds, relative to the first frame
   * in the tlog (the first frame is always 0). Used to schedule replay.
   */
  readonly timeUs: number;
  /** The raw MAVLink frame bytes (a view into the source buffer). */
  readonly bytes: Uint8Array;
}

/** Thrown when a tlog cannot be parsed (e.g. unknown MAVLink magic). */
export class TlogParseError extends Error {
  /** Byte offset at which parsing failed. */
  readonly offset: number;
  constructor(message: string, offset: number) {
    super(message);
    this.name = 'TlogParseError';
    this.offset = offset;
  }
}

/**
 * Compute the total byte length of the MAVLink frame starting at `offset`.
 * Returns `undefined` when there are not enough bytes to read the frame header
 * (a truncated trailing entry). Throws {@link TlogParseError} on unknown magic.
 */
function frameLengthAt(bytes: Uint8Array, offset: number): number | undefined {
  const magic = bytes[offset];
  if (magic === undefined) return undefined;

  if (magic === MAVLINK_V1_STX) {
    const payloadLen = bytes[offset + 1];
    if (payloadLen === undefined) return undefined;
    return V1_OVERHEAD + payloadLen;
  }

  if (magic === MAVLINK_V2_STX) {
    const payloadLen = bytes[offset + 1];
    const incompatFlags = bytes[offset + 2];
    if (payloadLen === undefined || incompatFlags === undefined) return undefined;
    const signatureLen = (incompatFlags & MAVLINK_IFLAG_SIGNED) !== 0 ? V2_SIGNATURE_BYTES : 0;
    return V2_OVERHEAD + payloadLen + signatureLen;
  }

  throw new TlogParseError(
    `Unknown MAVLink magic 0x${magic.toString(16).padStart(2, '0')} at offset ${offset}`,
    offset,
  );
}

/**
 * Parse a tlog into ordered frames with relative playback timestamps.
 *
 * Tolerant of a truncated trailing entry (a recording cut mid-frame): parsing
 * stops cleanly and returns the frames decoded so far. An unknown MAVLink magic
 * in the middle of the stream is a hard error (throws {@link TlogParseError}).
 */
export function parseTlog(input: ArrayBuffer | Uint8Array): TlogFrame[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const frames: TlogFrame[] = [];

  let pos = 0;
  let firstTicks: bigint | undefined;

  while (pos + TIMESTAMP_BYTES <= bytes.byteLength) {
    const ticks = view.getBigUint64(pos, false);
    const frameStart = pos + TIMESTAMP_BYTES;

    const frameLen = frameLengthAt(bytes, frameStart);
    if (frameLen === undefined) break; // truncated header → stop.
    if (frameStart + frameLen > bytes.byteLength) break; // truncated body → stop.

    if (firstTicks === undefined) firstTicks = ticks;
    const deltaUs = ticks - firstTicks;
    const timeUs = deltaUs > 0n ? Number(deltaUs) : 0;

    frames.push({
      timeTicks: ticks,
      timeUs,
      bytes: bytes.subarray(frameStart, frameStart + frameLen),
    });

    pos = frameStart + frameLen;
  }

  return frames;
}
