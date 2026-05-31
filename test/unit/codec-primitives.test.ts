/**
 * Unit tests for the codec primitives (task T1.1): CRC-16/MCRF4XX, SHA-256,
 * and field (de)serialization edge cases.
 */
import { describe, expect, it } from 'vitest';
import { crcAccumulateRange, crcAccumulate, CRC_INIT } from '../../src/mavlink/codec/crc';
import { sha256 } from '../../src/mavlink/codec/sha256';

function hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

describe('CRC-16/MCRF4XX', () => {
  it('matches the standard check value for "123456789"', () => {
    const data = new TextEncoder().encode('123456789');
    const crc = crcAccumulateRange(data, 0, data.length);
    expect(crc).toBe(0x6f91);
  });

  it('crcAccumulate folds bytes one at a time identically to the range form', () => {
    const data = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00, 0x7f]);
    let acc = CRC_INIT;
    for (const b of data) acc = crcAccumulate(b, acc);
    expect(acc).toBe(crcAccumulateRange(data, 0, data.length));
  });
});

describe('SHA-256', () => {
  it('hashes the empty string', () => {
    expect(hex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('hashes "abc"', () => {
    expect(hex(sha256(new TextEncoder().encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashes a multi-block (>55 byte) input', () => {
    const msg = 'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq';
    expect(hex(sha256(new TextEncoder().encode(msg)))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });
});
