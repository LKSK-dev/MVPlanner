/** Measurement-oriented DataFlash decode/query harness for T8.10. */
import { describe, expect, it } from 'vitest';
import { DataFlashDecoder, type DataFlashRecord } from '../../src/data/dataflash';
import { buildLogQueryIndex } from '../../src/data/log-query';
import {
  formatMiB,
  formatRate,
  heapDeltaBytes,
  measureSync,
  reportPerfLine,
  sampleMemory,
} from './helpers';

const HEADER_0 = 0xa3;
const HEADER_1 = 0x95;
const FMT_TYPE = 128;
const PERF_TYPE = 200;
const RECORD_FORMAT = 'Qffffffffffffff';
const RECORD_COLUMNS = 'TimeUS,A,B,C,D,E,F,G,H,I,J,K,L,M,N';
const RECORD_BODY_BYTES = 8 + 14 * 4;
const RECORD_PACKET_BYTES = 3 + RECORD_BODY_BYTES;
const RECORD_COUNT = 250_000;
const CHUNK_BYTES = 64 * 1024;
const FULL_GATE_MB = 500;

interface SyntheticDataFlashLog {
  readonly recordCount: number;
  readonly logicalBytes: number;
  readonly maxChunkBytes: number;
  chunks(): Iterable<Uint8Array<ArrayBuffer>>;
}

describe('perf: streaming DataFlash decode and first query', () => {
  it('decodes a large synthetic .bin stream into LogQueryIndex without retaining the input log', () => {
    const source = createSyntheticDataFlashLog(RECORD_COUNT, CHUNK_BYTES);
    const decodeOnlyBefore = sampleMemory();
    const decodeStart = performance.now();
    let decodedOnly = 0;
    for (const _record of decodeRecords(source.chunks())) decodedOnly += 1;
    const decodeOnlyMs = performance.now() - decodeStart;
    const decodeOnlyAfter = sampleMemory();

    const indexBefore = sampleMemory();
    const indexStart = performance.now();
    const index = buildLogQueryIndex(decodeRecords(source.chunks()));
    const indexMs = performance.now() - indexStart;
    const indexAfter = sampleMemory();

    let firstQueryPoints = 0;
    const firstQueryMs = measureSync(() => {
      firstQueryPoints = index.querySeries('PERF', 'A', undefined, 2_000).length;
    });

    const decodeMbPerSec = source.logicalBytes / (1024 * 1024) / (decodeOnlyMs / 1000);
    const indexMbPerSec = source.logicalBytes / (1024 * 1024) / (indexMs / 1000);
    const decodeRecordsPerSec = decodedOnly / (decodeOnlyMs / 1000);
    const projected500MbDecodeSec = FULL_GATE_MB / decodeMbPerSec;
    const projected500MbIndexSec = FULL_GATE_MB / indexMbPerSec;
    const decodeHeapDelta = heapDeltaBytes(decodeOnlyBefore, decodeOnlyAfter);
    const indexHeapDelta = heapDeltaBytes(indexBefore, indexAfter);
    const descriptors = index.listSeries();

    reportPerfLine(
      [
        'T8.10 DataFlash perf:',
        `records=${formatRate(decodedOnly)}`,
        `logical log=${formatMiB(source.logicalBytes)}`,
        `max generated chunk=${formatMiB(source.maxChunkBytes)}`,
        `decode=${decodeOnlyMs.toFixed(2)}ms (${formatRate(decodeRecordsPerSec, 0)} rec/sec, ${decodeMbPerSec.toFixed(2)} MiB/sec)`,
        `decode+index=${indexMs.toFixed(2)}ms (${indexMbPerSec.toFixed(2)} MiB/sec)`,
        `series=${descriptors.length}`,
        `first query=${firstQueryMs.toFixed(3)}ms points=${firstQueryPoints}`,
        decodeHeapDelta === undefined
          ? 'decode heap delta=n/a'
          : `decode heap delta=${formatMiB(decodeHeapDelta)}`,
        indexHeapDelta === undefined
          ? 'index heap delta=n/a'
          : `index heap delta=${formatMiB(indexHeapDelta)}`,
        `500MiB extrapolation at measured rate: decode≈${projected500MbDecodeSec.toFixed(1)}s, decode+index≈${projected500MbIndexSec.toFixed(1)}s`,
        'budget mapping: this tractable synthetic proves streaming/bounded decode and first-query behavior; true 500MB/browser plot-paint remains a nightly/browser gate.',
      ].join(' | '),
    );

    expect(decodedOnly).toBe(source.recordCount);
    expect(source.logicalBytes).toBeGreaterThan(10 * 1024 * 1024);
    expect(source.maxChunkBytes).toBeLessThanOrEqual(CHUNK_BYTES + RECORD_PACKET_BYTES);
    expect(decodeRecordsPerSec).toBeGreaterThan(5_000);
    expect(indexMbPerSec).toBeGreaterThan(1);
    expect(descriptors.length).toBe(15);
    expect(firstQueryPoints).toBeGreaterThan(0);
    expect(firstQueryMs).toBeLessThan(2_000);
    if (decodeHeapDelta !== undefined) expect(decodeHeapDelta).toBeLessThan(64 * 1024 * 1024);
    if (indexHeapDelta !== undefined) expect(indexHeapDelta).toBeLessThan(500 * 1024 * 1024);
  });
});

function createSyntheticDataFlashLog(
  recordCount: number,
  chunkBytes: number,
): SyntheticDataFlashLog {
  return {
    recordCount,
    logicalBytes: fmtPacket().byteLength + recordCount * RECORD_PACKET_BYTES,
    maxChunkBytes: Math.max(fmtPacket().byteLength, chunkBytes + RECORD_PACKET_BYTES),
    chunks: () => dataFlashChunks(recordCount, chunkBytes),
  };
}

function* dataFlashChunks(
  recordCount: number,
  chunkBytes: number,
): Generator<Uint8Array<ArrayBuffer>, void, void> {
  yield fmtPacket();

  let nextRecord = 0;
  while (nextRecord < recordCount) {
    const recordsInChunk = Math.max(
      1,
      Math.min(recordCount - nextRecord, Math.floor(chunkBytes / RECORD_PACKET_BYTES)),
    );
    const bytes = new Uint8Array(recordsInChunk * RECORD_PACKET_BYTES);
    for (let i = 0; i < recordsInChunk; i++) {
      writeRecord(bytes, i * RECORD_PACKET_BYTES, nextRecord + i);
    }
    nextRecord += recordsInChunk;
    yield bytes;
  }
}

function* decodeRecords(chunks: Iterable<Uint8Array>): Generator<DataFlashRecord, void, void> {
  const decoder = new DataFlashDecoder();
  for (const chunk of chunks) {
    for (const record of decoder.feed(chunk)) yield record;
  }
  decoder.finish();
}

function fmtPacket(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(89);
  bytes[0] = HEADER_0;
  bytes[1] = HEADER_1;
  bytes[2] = FMT_TYPE;
  bytes[3] = PERF_TYPE;
  bytes[4] = RECORD_PACKET_BYTES;
  writeAscii(bytes, 5, 4, 'PERF');
  writeAscii(bytes, 9, 16, RECORD_FORMAT);
  writeAscii(bytes, 25, 64, RECORD_COLUMNS);
  return bytes;
}

function writeRecord(bytes: Uint8Array, offset: number, index: number): void {
  bytes[offset] = HEADER_0;
  bytes[offset + 1] = HEADER_1;
  bytes[offset + 2] = PERF_TYPE;
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset + 3, RECORD_BODY_BYTES);
  view.setBigUint64(0, BigInt(index) * 20_000n, true);
  for (let field = 0; field < 14; field++) {
    view.setFloat32(8 + field * 4, Math.sin((index + field) / 100) * 100 + field, true);
  }
}

function writeAscii(bytes: Uint8Array, offset: number, length: number, value: string): void {
  for (let i = 0; i < Math.min(length, value.length); i += 1) {
    const code = value.charCodeAt(i);
    bytes[offset + i] = code;
  }
}
