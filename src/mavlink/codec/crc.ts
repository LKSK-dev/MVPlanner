/**
 * CRC-16/MCRF4XX — the checksum MAVLink uses for both v1 and v2 frames
 * (spec plan/03 §3.1). Initial value `0xFFFF`, reflected polynomial `0x8408`.
 *
 * The frame checksum is accumulated over every byte AFTER the start-of-frame
 * magic up to and including the payload, and then one extra `crcExtra` byte
 * (the per-message seed from the dialect table) is fed in last. The 16-bit
 * result is written little-endian on the wire.
 */

/** Initial CRC accumulator value for CRC-16/MCRF4XX. */
export const CRC_INIT = 0xffff;

/**
 * Fold a single byte into a running CRC accumulator. This is the canonical
 * MAVLink `crc_accumulate` step.
 *
 * @param data - byte to accumulate (only the low 8 bits are used)
 * @param acc - current 16-bit accumulator
 * @returns the updated 16-bit accumulator
 */
export function crcAccumulate(data: number, acc: number): number {
  let tmp = (data ^ (acc & 0xff)) & 0xff;
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return ((acc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}

/**
 * Accumulate every byte of `bytes[start..end)` into `acc`.
 *
 * @param bytes - source buffer
 * @param start - inclusive start index
 * @param end - exclusive end index
 * @param acc - current accumulator (defaults to {@link CRC_INIT})
 */
export function crcAccumulateRange(
  bytes: Uint8Array,
  start: number,
  end: number,
  acc: number = CRC_INIT,
): number {
  let crc = acc;
  for (let i = start; i < end; i++) {
    crc = crcAccumulate(bytes[i] as number, crc);
  }
  return crc;
}
