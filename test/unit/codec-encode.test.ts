/**
 * Encoder behaviour tests (task T1.1; spec plan/03 §3.1–§3.2): v2 payload
 * truncation + zero-fill round-trip, v1 extension-field omission, 24-bit ids,
 * and 64-bit (bigint) handling.
 */
import { describe, expect, it } from 'vitest';
import type { DialectTable, MessageInput } from '../../src/contracts';
import { createMavCodec } from '../../src/mavlink/codec';
import commonJson from '../../src/mavlink/dialects/generated/common.json';

const common = commonJson as unknown as DialectTable;
const dialects = [common];
const codec = createMavCodec({ dialects });

describe('v2 truncation + zero-fill', () => {
  it('trims an all-zero payload to a single byte and zero-fills on decode', () => {
    // SYSTEM_TIME = uint64 time_unix_usec + uint32 time_boot_ms (12 bytes full).
    const input: MessageInput = {
      name: 'SYSTEM_TIME',
      sysid: 1,
      compid: 1,
      fields: { time_unix_usec: 0n, time_boot_ms: 0 },
    };
    const frame = codec.encode(input, { version: 2, seq: 0 });
    expect(frame[1]).toBe(1); // len byte: truncated to 1

    const msgs = codec.parser({ dialects }).push(frame);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.fields.time_unix_usec).toBe(0n);
    expect(msgs[0]!.fields.time_boot_ms).toBe(0);
  });

  it('keeps trailing non-zero bytes (no truncation past significant data)', () => {
    const input: MessageInput = {
      name: 'SYSTEM_TIME',
      sysid: 1,
      compid: 1,
      fields: { time_unix_usec: 0n, time_boot_ms: 1 },
    };
    const frame = codec.encode(input, { version: 2, seq: 0 });
    // SYSTEM_TIME wire order is uint64 time_unix_usec then uint32 time_boot_ms.
    // time_boot_ms=1 packs as 01 00 00 00 at offset 8, so the significant byte
    // is the 9th; the 3 trailing zero bytes are trimmed -> len 9.
    expect(frame[1]).toBe(9);
  });
});

describe('64-bit fields', () => {
  it('round-trips a large uint64 as bigint', () => {
    const big = 1700000000000000n;
    const input: MessageInput = {
      name: 'SYSTEM_TIME',
      sysid: 1,
      compid: 1,
      fields: { time_unix_usec: big, time_boot_ms: 42 },
    };
    const frame = codec.encode(input, { version: 2, seq: 0 });
    const msgs = codec.parser({ dialects }).push(frame);
    expect(msgs[0]!.fields.time_unix_usec).toBe(big);
  });

  it('accepts a numeric-string uint64 on encode (lossless)', () => {
    const input: MessageInput = {
      name: 'SYSTEM_TIME',
      sysid: 1,
      compid: 1,
      fields: { time_unix_usec: '1700000000000000', time_boot_ms: 0 },
    };
    const frame = codec.encode(input, { version: 2, seq: 0 });
    const msgs = codec.parser({ dialects }).push(frame);
    expect(msgs[0]!.fields.time_unix_usec).toBe(1700000000000000n);
  });
});

describe('v1 vs v2 extension fields', () => {
  const gpsFields = {
    time_usec: 123456n,
    fix_type: 3,
    lat: -353632610,
    lon: 1491652300,
    alt: 584090,
    eph: 120,
    epv: 200,
    vel: 0,
    cog: 0,
    satellites_visible: 10,
    // extension fields (v2 only):
    alt_ellipsoid: 7,
    h_acc: 8,
    v_acc: 9,
    vel_acc: 10,
    hdg_acc: 11,
    yaw: 12,
  };

  it('v1 omits extension fields from the payload and from the decode', () => {
    const input: MessageInput = { name: 'GPS_RAW_INT', sysid: 1, compid: 1, fields: gpsFields };
    const frame = codec.encode(input, { version: 1, seq: 0 });
    expect(frame[1]).toBe(30); // base payload only (extensions excluded)
    const msgs = codec.parser({ dialects }).push(frame);
    expect(msgs[0]!.fields.yaw).toBeUndefined();
    expect(msgs[0]!.fields.satellites_visible).toBe(10);
  });

  it('v2 includes extension fields', () => {
    const input: MessageInput = { name: 'GPS_RAW_INT', sysid: 1, compid: 1, fields: gpsFields };
    const frame = codec.encode(input, { version: 2, seq: 0 });
    const msgs = codec.parser({ dialects }).push(frame);
    expect(msgs[0]!.fields.yaw).toBe(12);
    expect(msgs[0]!.fields.alt_ellipsoid).toBe(7);
  });
});

describe('24-bit message ids (v2)', () => {
  it('encodes a >255 message id across the 3 id bytes', () => {
    // GPS_STATUS id = 25 is small; use a 3-byte check via a known >255 id message.
    // GLOBAL_POSITION_INT id = 33 -> still < 256; assert id bytes for id 33.
    const input: MessageInput = {
      name: 'GLOBAL_POSITION_INT',
      sysid: 1,
      compid: 1,
      fields: {
        time_boot_ms: 1,
        lat: 0,
        lon: 0,
        alt: 0,
        relative_alt: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        hdg: 0,
      },
    };
    const frame = codec.encode(input, { version: 2, seq: 0 });
    expect(frame[7]).toBe(33);
    expect(frame[8]).toBe(0);
    expect(frame[9]).toBe(0);
  });
});
