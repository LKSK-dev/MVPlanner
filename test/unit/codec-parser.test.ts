/**
 * Streaming-parser robustness tests (task T1.1; spec plan/03 §3.2/§3.7):
 * resync on garbage, split frames across pushes, corrupt-CRC drop, byte-by-byte
 * feeding, and v2 signing accept/reject.
 */
import { describe, expect, it } from 'vitest';
import type { DialectTable, MessageInput } from '../../src/contracts';
import { createMavCodec } from '../../src/mavlink/codec';
import commonJson from '../../src/mavlink/dialects/generated/common.json';

const common = commonJson as unknown as DialectTable;
const dialects = [common];
const codec = createMavCodec({ dialects });

const heartbeat: MessageInput = {
  name: 'HEARTBEAT',
  sysid: 1,
  compid: 1,
  fields: {
    type: 2,
    autopilot: 3,
    base_mode: 81,
    custom_mode: 0,
    system_status: 4,
    mavlink_version: 3,
  },
};

function frameV2(seq: number): Uint8Array {
  return codec.encode(heartbeat, { version: 2, seq });
}
function frameV1(seq: number): Uint8Array {
  return codec.encode(heartbeat, { version: 1, seq });
}

describe('StreamingParser resync & robustness', () => {
  it('never throws on random garbage and recovers sync afterwards', () => {
    const parser = codec.parser({ dialects });
    let seed = 0x12345678;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return (seed >> 8) & 0xff;
    };
    for (let iter = 0; iter < 500; iter++) {
      const len = rand() % 64;
      const junk = new Uint8Array(len);
      for (let i = 0; i < len; i++) junk[i] = rand();
      expect(() => parser.push(junk)).not.toThrow();
    }
    // After arbitrary garbage, a clean frame still decodes.
    const msgs = parser.push(frameV2(7));
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    const hb = msgs.find((m) => m.name === 'HEARTBEAT');
    expect(hb).toBeDefined();
    expect(hb!.seq).toBe(7);
  });

  it('decodes a valid frame split across multiple push() calls', () => {
    const parser = codec.parser({ dialects });
    const frame = frameV2(11);
    const a = frame.subarray(0, 5);
    const b = frame.subarray(5, 9);
    const c = frame.subarray(9);
    expect(parser.push(a)).toHaveLength(0);
    expect(parser.push(b)).toHaveLength(0);
    const msgs = parser.push(c);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.seq).toBe(11);
  });

  it('feeds a frame one byte at a time and decodes exactly once', () => {
    const parser = codec.parser({ dialects });
    const frame = frameV1(3);
    let total = 0;
    let last = -1;
    for (let i = 0; i < frame.length; i++) {
      const msgs = parser.push(frame.subarray(i, i + 1));
      total += msgs.length;
      if (msgs.length) last = msgs[0]!.seq;
    }
    expect(total).toBe(1);
    expect(last).toBe(3);
  });

  it('drops a frame with a corrupted CRC but still decodes the next valid frame', () => {
    const parser = codec.parser({ dialects });
    const bad = frameV2(20);
    const ci = bad.length - 1;
    bad[ci] = ((bad[ci] ?? 0) ^ 0xff) & 0xff; // corrupt the CRC high byte
    expect(parser.push(bad)).toHaveLength(0);
    const good = frameV2(21);
    const msgs = parser.push(good);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.seq).toBe(21);
  });

  it('resyncs past a leading false magic byte', () => {
    const parser = codec.parser({ dialects });
    const frame = frameV2(5);
    const stream = new Uint8Array(frame.length + 3);
    stream[0] = 0xfd; // false v2 magic
    stream[1] = 0xfe; // false v1 magic
    stream[2] = 0x00;
    stream.set(frame, 3);
    const msgs = parser.push(stream);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.seq).toBe(5);
  });

  it('drops a v2 frame with an unknown incompat bit but decodes a following valid frame', () => {
    const parser = codec.parser({ dialects });
    const bad = frameV2(30);
    bad[2] = 0x02; // unknown incompat bit (not MAVLINK_IFLAG_SIGNED) — must be discarded
    const good = frameV2(31);
    const stream = new Uint8Array(bad.length + good.length);
    stream.set(bad, 0);
    stream.set(good, bad.length);
    const msgs = parser.push(stream);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.seq).toBe(31);
  });

  it('resyncs past a false 0xFD magic with an oversized length header to a later valid frame', () => {
    const parser = codec.parser({ dialects });
    const good = frameV2(42);
    const stream = new Uint8Array(4 + good.length);
    stream[0] = 0xfd; // false v2 magic
    stream[1] = 0xff; // oversized payload length: claims a 255-byte payload (frame never completes)
    stream[2] = 0x00; // incompat flags: no unknown bits, so this exercises the length skip-ahead
    stream[3] = 0x00; // compat flags
    stream.set(good, 4);
    const msgs = parser.push(stream);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.seq).toBe(42);
    // The oversized candidate must not be retained: the buffer stays bounded and
    // a fresh frame decodes alone on the next push.
    const next = parser.push(frameV2(43));
    expect(next).toHaveLength(1);
    expect(next[0]!.seq).toBe(43);
  });

  it('decodes two back-to-back frames in a single push', () => {
    const parser = codec.parser({ dialects });
    const a = frameV2(1);
    const b = frameV1(2);
    const stream = new Uint8Array(a.length + b.length);
    stream.set(a, 0);
    stream.set(b, a.length);
    const msgs = parser.push(stream);
    expect(msgs).toHaveLength(2);
    expect(msgs[0]!.seq).toBe(1);
    expect(msgs[1]!.seq).toBe(2);
  });

  it('reset() clears buffered partial-frame state', () => {
    const parser = codec.parser({ dialects });
    const frame = frameV2(9);
    parser.push(frame.subarray(0, 6)); // buffer a partial frame
    parser.reset();
    // Feeding the remainder alone must NOT complete the previously partial frame.
    expect(parser.push(frame.subarray(6))).toHaveLength(0);
  });
});

describe('v2 signing accept/reject', () => {
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) key[i] = i;

  it('verifies a valid signature and reports signed + linkId', () => {
    const signed = codec.encode(heartbeat, {
      version: 2,
      seq: 0,
      signing: { enabled: true, key, linkId: 1 },
      timestamp: 1234567n,
    });
    const parser = codec.parser({ dialects, signing: { enabled: true, key, linkId: 1 } });
    const msgs = parser.push(signed);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.signed).toBe(true);
    expect(msgs[0]!.linkId).toBe(1);
  });

  it('rejects a frame whose signature has been tampered with', () => {
    const signed = codec.encode(heartbeat, {
      version: 2,
      seq: 0,
      signing: { enabled: true, key, linkId: 1 },
      timestamp: 1234567n,
    });
    const si = signed.length - 1;
    signed[si] = ((signed[si] ?? 0) ^ 0x01) & 0xff; // flip a signature byte
    const parser = codec.parser({ dialects, signing: { enabled: true, key, linkId: 1 } });
    expect(parser.push(signed)).toHaveLength(0);
  });

  it('rejects a validly-signed frame verified under the wrong key', () => {
    const signed = codec.encode(heartbeat, {
      version: 2,
      seq: 0,
      signing: { enabled: true, key, linkId: 1 },
      timestamp: 1234567n,
    });
    const wrongKey = new Uint8Array(32);
    for (let i = 0; i < 32; i++) wrongKey[i] = (i + 1) & 0xff; // differs from `key`
    const parser = codec.parser({ dialects, signing: { enabled: true, key: wrongKey, linkId: 1 } });
    expect(parser.push(signed)).toHaveLength(0);
  });

  it('rejects an unsigned frame when allowUnsigned is undefined (secure default)', () => {
    const unsigned = codec.encode(heartbeat, { version: 2, seq: 0 });
    const parser = codec.parser({ dialects, signing: { enabled: true, key, linkId: 1 } });
    expect(parser.push(unsigned)).toHaveLength(0);
  });

  it('rejects an unsigned frame when allowUnsigned is false', () => {
    const unsigned = codec.encode(heartbeat, { version: 2, seq: 0 });
    const parser = codec.parser({
      dialects,
      signing: { enabled: true, key, linkId: 1, allowUnsigned: false },
    });
    expect(parser.push(unsigned)).toHaveLength(0);
  });

  it('accepts an unsigned frame when allowUnsigned is true (signed=false)', () => {
    const unsigned = codec.encode(heartbeat, { version: 2, seq: 4 });
    const parser = codec.parser({
      dialects,
      signing: { enabled: true, key, linkId: 1, allowUnsigned: true },
    });
    const msgs = parser.push(unsigned);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.signed).toBe(false);
  });

  it('rejects a replayed timestamp when monotonicity is enforced', () => {
    const opts = {
      version: 2 as const,
      seq: 0,
      signing: { enabled: true, key, linkId: 1 },
      timestamp: 1000n,
    };
    const first = codec.encode(heartbeat, opts);
    const replay = codec.encode(heartbeat, opts); // identical timestamp
    const parser = codec.parser({
      dialects,
      signing: { enabled: true, key, linkId: 1 },
      enforceTimestampMonotonic: true,
    });
    expect(parser.push(first)).toHaveLength(1);
    expect(parser.push(replay)).toHaveLength(0);
  });
});
