/**
 * MAVLink codec public surface (task T1.1; spec plan/03 §3.1–§3.2).
 *
 * A pure, dependency-free TypeScript implementation of MAVLink v1/v2 framing,
 * CRC-16/MCRF4XX with per-message `crcExtra`, v2 payload truncation + extension
 * fields, and v2 message signing. Implements the frozen `MavCodec`/`MavParser`
 * contracts in `src/contracts/mavlink.ts`.
 *
 * @see ./README.md for the contract, owned files, and how to test.
 */
export { createMavCodec } from './codec';
export type { Codec, CodecConfig, EncodeOptions, ParserOptions } from './codec';
export { StreamingParser } from './parser';
export type { ParserExtras } from './parser';
export { encodeFrame, MAGIC_V1, MAGIC_V2 } from './encode';
export type { EncodeFrameOptions, FrameSigning } from './encode';
export { MavCodecError } from './field-codec';
export {
  SigningState,
  computeSignature,
  signingTimestampNow,
  MAVLINK_IFLAG_SIGNED,
  SIGNATURE_LEN,
} from './signing';
export { sha256 } from './sha256';
export { crcAccumulate, crcAccumulateRange, CRC_INIT } from './crc';
