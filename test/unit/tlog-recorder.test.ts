/**
 * tlog recorder tests (task T2.10; spec plan/07 §7.4, plan/02 §2.6).
 *
 * Covers the wire format (u64 BE microseconds), append order, start/stop +
 * frameCount/size/duration, chunked persistence into a real {@link BlobStore}
 * (fake-indexeddb), `export()` as a single blob, auto-start-on-connect, and — the
 * critical guarantee — the record→export→`parseTlog` ROUND-TRIP, asserting the
 * recovered frames and relative timestamps equal the input.
 */
import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createStorage, type AppStorage } from '../../src/data/storage';
import { parseTlog } from '../../src/transport/replay';
import {
  TlogRecorder,
  encodeTlogEntry,
  type ConnStateLike,
  type RawFrameLike,
  type RawFrameSource,
} from '../../src/data/tlog';
import { microsToTlogTimestamp } from '../../src/data/tlog/encoder';

let uid = 0;
/** Unique DB name per call so tests do not share IndexedDB state. */
const dbName = (): string => `mvp-tlog-${Date.now()}-${uid++}`;

/** Storage bound to a fresh DB with the persistence request disabled. */
function newStorage(): AppStorage {
  return createStorage({ name: dbName(), requestPersistence: false });
}

/** A controllable raw-frame + state source standing in for the MAVLink host. */
class FakeSource implements RawFrameSource {
  private rawCb: ((f: RawFrameLike) => void) | undefined;
  private stateCb: ((s: ConnStateLike) => void) | undefined;

  onRawFrame(cb: (f: RawFrameLike) => void): () => void {
    this.rawCb = cb;
    return () => {
      this.rawCb = undefined;
    };
  }

  onState(cb: (s: ConnStateLike) => void): () => void {
    this.stateCb = cb;
    return () => {
      this.stateCb = undefined;
    };
  }

  /** Push a synthetic frame to the recorder's tap. */
  emit(raw: Uint8Array, rxTimeUs: number, msgId = 0): void {
    this.rawCb?.({ raw, rxTimeUs, sysid: 1, compid: 1, msgId });
  }

  /** Push a connection-state transition. */
  state(kind: string): void {
    this.stateCb?.({ kind });
  }

  get hasRawListener(): boolean {
    return this.rawCb !== undefined;
  }
}

/** Build a deterministic MAVLink v1 frame (8 + payloadLen bytes). */
function makeV1(payloadLen: number, seed: number): Uint8Array {
  const b = new Uint8Array(8 + payloadLen);
  for (let i = 0; i < b.length; i++) b[i] = (seed + i) & 0xff;
  b[0] = 0xfe;
  b[1] = payloadLen;
  return b;
}

/** Build a deterministic MAVLink v2 frame (12 + payloadLen [+13 if signed]). */
function makeV2(payloadLen: number, signed: boolean, seed: number): Uint8Array {
  const b = new Uint8Array(12 + payloadLen + (signed ? 13 : 0));
  for (let i = 0; i < b.length; i++) b[i] = (seed + i) & 0xff;
  b[0] = 0xfd;
  b[1] = payloadLen;
  b[2] = signed ? 0x01 : 0x00;
  return b;
}

describe('tlog encoder', () => {
  it('converts microseconds to tlog timestamps, clamping bad clocks to 0', () => {
    expect(microsToTlogTimestamp(0)).toBe(0n);
    expect(microsToTlogTimestamp(1)).toBe(1n);
    expect(microsToTlogTimestamp(123_456)).toBe(123_456n);
    expect(microsToTlogTimestamp(-5)).toBe(0n);
    expect(microsToTlogTimestamp(Number.NaN)).toBe(0n);
    expect(microsToTlogTimestamp(Number.POSITIVE_INFINITY)).toBe(0n);
  });

  it('writes a big-endian u64 timestamp prefix followed by the raw frame', () => {
    const raw = makeV1(3, 7);
    const entry = encodeTlogEntry(200, raw);
    expect(entry.byteLength).toBe(8 + raw.byteLength);

    const view = new DataView(entry.buffer, entry.byteOffset, entry.byteLength);
    expect(view.getBigUint64(0, false)).toBe(200n); // big-endian
    // High bytes are leading (BE): 200 = 0x00C8.
    expect(entry[6]).toBe(0x00);
    expect(entry[7]).toBe(0xc8);
    expect(entry.subarray(8)).toEqual(raw);
  });
});

describe('TlogRecorder lifecycle', () => {
  it('taps the source on construction and records only between start/stop', async () => {
    const src = new FakeSource();
    const { blobs } = newStorage();
    const rec = new TlogRecorder({ source: src, blobs });

    expect(src.hasRawListener).toBe(true);
    expect(rec.isRecording).toBe(false);

    // Dropped before start.
    src.emit(makeV1(1, 0), 100);
    expect(rec.stats().frameCount).toBe(0);

    const id = await rec.start();
    expect(rec.isRecording).toBe(true);
    expect(rec.currentId).toBe(id);

    src.emit(makeV1(2, 1), 1000);
    src.emit(makeV2(3, false, 2), 3000);
    expect(rec.stats().frameCount).toBe(2);

    await rec.stop();
    expect(rec.isRecording).toBe(false);

    // Dropped after stop.
    src.emit(makeV1(1, 9), 9000);
    expect(rec.stats().frameCount).toBe(2);

    await rec.dispose();
    expect(src.hasRawListener).toBe(false);
  });

  it('reports frameCount, byte size and duration from recorded frames', async () => {
    const src = new FakeSource();
    const { blobs } = newStorage();
    const rec = new TlogRecorder({ source: src, blobs });
    await rec.start();

    const f0 = makeV1(2, 0); // 10 bytes + 8 ts
    const f1 = makeV2(4, false, 5); // 16 bytes + 8 ts
    src.emit(f0, 1000);
    src.emit(f1, 4000);
    await rec.stop();

    const stats = rec.stats();
    expect(stats.frameCount).toBe(2);
    expect(stats.sizeBytes).toBe(8 + f0.byteLength + 8 + f1.byteLength);
    expect(stats.durationUs).toBe(3000); // 4000 - 1000
  });

  it('rejects a second concurrent start', async () => {
    const src = new FakeSource();
    const { blobs } = newStorage();
    const rec = new TlogRecorder({ source: src, blobs });
    await rec.start();
    await expect(rec.start()).rejects.toThrow(/already recording/);
    await rec.dispose();
  });
});

describe('TlogRecorder chunked persistence', () => {
  it('flushes multiple chunks to the blob store and exports them in order', async () => {
    const src = new FakeSource();
    const { blobs } = newStorage();
    // Tiny threshold so each frame forces its own chunk.
    const rec = new TlogRecorder({
      source: src,
      blobs,
      namespace: 'tlog-test',
      chunkBytes: 1,
      idFactory: () => 'fixed-id',
    });

    const id = await rec.start();
    src.emit(makeV1(1, 0), 1000);
    src.emit(makeV1(1, 1), 2000);
    src.emit(makeV1(1, 2), 3000);
    await rec.stop();

    // Three chunk records were persisted under the recording id.
    const listed = await blobs.list('tlog-test');
    const chunkKeys = listed.map((m) => m.key).filter((k) => k.startsWith(`${id}/`));
    expect(chunkKeys).toContain(`${id}/0`);
    expect(chunkKeys).toContain(`${id}/1`);
    expect(chunkKeys).toContain(`${id}/2`);

    const blob = await rec.export();
    expect(blob.size).toBe(rec.stats().sizeBytes);
  });

  it('export includes an un-flushed tail buffer', async () => {
    const src = new FakeSource();
    const { blobs } = newStorage();
    // Large threshold so nothing flushes; everything stays in the tail buffer.
    const rec = new TlogRecorder({ source: src, blobs, chunkBytes: 1 << 20 });
    await rec.start();
    src.emit(makeV1(2, 3), 500);
    src.emit(makeV1(2, 4), 1500);
    const blob = await rec.export();
    expect(blob.size).toBe(rec.stats().sizeBytes);
    await rec.dispose();
  });

  it('persists a sidecar metadata record separately from chunks', async () => {
    const src = new FakeSource();
    const { blobs } = newStorage();
    const rec = new TlogRecorder({
      source: src,
      blobs,
      namespace: 'tlog-sidecar',
      idFactory: () => 'sc',
      now: () => 1234,
    });
    await rec.start({ vehicleType: 'ArduCopter' });
    await rec.stop();

    const listed = await blobs.list('tlog-sidecar');
    const sidecar = listed.find((m) => m.key === 'sc/sidecar');
    expect(sidecar).toBeDefined();
    expect(sidecar?.meta).toMatchObject({ vehicleType: 'ArduCopter', startedAtMs: 1234 });
  });
});

describe('TlogRecorder auto-start-on-connect', () => {
  it('starts on open and stops on closed', async () => {
    const src = new FakeSource();
    const { blobs } = newStorage();
    const rec = new TlogRecorder({ source: src, blobs, autoStartOnConnect: true });

    expect(rec.isRecording).toBe(false);
    src.state('open');
    // start() is async (sidecar write path); allow the microtask to settle.
    await Promise.resolve();
    expect(rec.isRecording).toBe(true);

    src.emit(makeV1(1, 0), 1000);
    src.state('closed');
    await Promise.resolve();
    expect(rec.isRecording).toBe(false);
    await rec.dispose();
  });
});

describe('TlogRecorder ↔ parseTlog round-trip', () => {
  it('record → export → parseTlog recovers the exact frames and relative timing', async () => {
    const src = new FakeSource();
    const { blobs } = newStorage();
    const rec = new TlogRecorder({
      source: src,
      blobs,
      namespace: 'tlog-rt',
      chunkBytes: 24, // force several chunk boundaries mid-stream
      idFactory: () => 'rt',
    });

    // Synthetic frames: v1, v2 unsigned, v2 signed, at increasing rx times (us).
    const inputs: { raw: Uint8Array; rxTimeUs: number }[] = [
      { raw: makeV1(3, 10), rxTimeUs: 1_000_000 },
      { raw: makeV2(5, false, 100), rxTimeUs: 1_002_000 },
      { raw: makeV2(4, true, 200), rxTimeUs: 1_005_000 },
      { raw: makeV1(2, 50), rxTimeUs: 1_005_500 },
    ];

    await rec.start();
    for (const f of inputs) src.emit(f.raw, f.rxTimeUs);
    await rec.stop();

    const blob = await rec.export();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const parsed = parseTlog(bytes);

    expect(parsed).toHaveLength(inputs.length);

    const baseUs = inputs[0]!.rxTimeUs;
    const baseTimestamp = microsToTlogTimestamp(baseUs);
    for (let i = 0; i < inputs.length; i++) {
      const want = inputs[i]!;
      const got = parsed[i]!;
      // Exact frame bytes preserved in order.
      expect(got.bytes).toEqual(want.raw);
      // Absolute tlog timestamp is rxTimeUs.
      expect(got.timeTicks).toBe(microsToTlogTimestamp(want.rxTimeUs));
      // parseTlog's relative timeUs == delta from the first frame.
      const expectedRelUs = Number(microsToTlogTimestamp(want.rxTimeUs) - baseTimestamp);
      expect(got.timeUs).toBe(expectedRelUs);
      expect(got.timeUs).toBe(want.rxTimeUs - baseUs);
    }
  });
});
