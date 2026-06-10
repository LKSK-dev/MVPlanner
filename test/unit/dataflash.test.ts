/** Unit tests for the T6.2 streaming DataFlash decoder. */
import { describe, expect, it } from 'vitest';
import {
  DataFlashDecoder,
  decodeDataFlash,
  enumerateDataFlashTypes,
  iterateDataFlashRecords,
  type DataFlashRecord,
} from '../../src/data/dataflash';

const HEADER = [0xa3, 0x95] as const;
const FMT_TYPE = 128;

describe('DataFlashDecoder', () => {
  it('decodes FMT-defined records identically in one chunk and split chunks', () => {
    const log = buildFixture();
    const oneChunk = decodeWithChunks([log]);
    const split = decodeWithChunks(splitEvery(log, 7));

    expect(split).toEqual(oneChunk);
    expect(oneChunk).toHaveLength(3);

    const tst = oneChunk[0]!;
    expect(tst.name).toBe('TST1');
    expect(tst.type).toBe(200);
    expect(tst.fields.Val).toBeCloseTo(12.5);
    expect(tst.fields.Small).toBe(-123);
    expect(tst.fields.Lat).toBeCloseTo(37.4221234);
    expect(tst.fields.Count).toBe(9_007_199_254_740_993n);

    const gps = oneChunk[2]!;
    expect(gps.name).toBe('GPS');
    expect(gps.fields.Lat).toBeCloseTo(37.4221234);
    expect(gps.fields.Lng).toBeCloseTo(-122.0845678);
    expect(gps.fields.Alt).toBeCloseTo(101.25);
  });

  it('resynchronises after bad headers and garbage bytes', () => {
    const log = buildFixture();
    const withGarbage = concatBytes(
      new Uint8Array([0x00, 0x01, 0xa3, 0x00, 0x55]),
      log.subarray(0, 89 * 2),
      new Uint8Array([0x99, 0xa3, 0x12, 0x95]),
      log.subarray(89 * 2),
    );

    const decoded = decodeWithChunks(splitEvery(withGarbage, 5));
    expect(decoded).toHaveLength(3);
    expect(decoded.map((record) => record.name)).toEqual(['TST1', 'TST1', 'GPS']);
  });

  it('reports true record offsets after a garbage prefix resync', () => {
    const log = concatBytes(
      new Uint8Array([0x11, 0x22]),
      fmtPacket(202, 'OFFS', 'f', 'Value'),
      recordPacket(
        202,
        (view) => {
          view.setFloat32(0, 42.5, true);
        },
        4,
      ),
    );

    const decoded = decodeWithChunks(splitEvery(log, 17));
    expect(decoded).toHaveLength(1);
    expect(decoded[0]?.offset).toBe(91);
    expect(decoded[0]?.fields.Value).toBeCloseTo(42.5);
  });

  it('enumerates types and lazily iterates records of one type', async () => {
    const log = buildFixture();
    const types = await enumerateDataFlashTypes([log]);

    expect(types.map((type) => [type.type, type.name, type.fieldFormats])).toEqual([
      [200, 'TST1', ['f', 'h', 'L', 'Q']],
      [201, 'GPS', ['L', 'L', 'f']],
    ]);

    const gps: DataFlashRecord[] = [];
    for await (const record of iterateDataFlashRecords(splitEvery(log, 11), 'GPS'))
      gps.push(record);
    expect(gps).toHaveLength(1);
    expect(gps[0]!.fields.Lng).toBeCloseTo(-122.0845678);
  });

  it('supports the async iterator decode helper', async () => {
    const log = buildFixture();
    const decoded: DataFlashRecord[] = [];
    for await (const record of decodeDataFlash(splitEvery(log, 13))) decoded.push(record);
    expect(decoded).toHaveLength(3);
    expect(decoded[0]!.fields.Count).toBe(9_007_199_254_740_993n);
  });
});

function decodeWithChunks(chunks: readonly Uint8Array[]): readonly DataFlashRecord[] {
  const decoder = new DataFlashDecoder();
  const records: DataFlashRecord[] = [];
  for (const chunk of chunks) records.push(...decoder.feed(chunk));
  decoder.finish();
  return records;
}

function buildFixture(): Uint8Array {
  return concatBytes(
    fmtPacket(200, 'TST1', 'fhLQ', 'Val,Small,Lat,Count'),
    fmtPacket(201, 'GPS', 'LLf', 'Lat,Lng,Alt'),
    recordPacket(
      200,
      (view) => {
        view.setFloat32(0, 12.5, true);
        view.setInt16(4, -123, true);
        view.setInt32(6, Math.round(37.4221234 * 10_000_000), true);
        view.setBigUint64(10, 9_007_199_254_740_993n, true);
      },
      18,
    ),
    recordPacket(
      200,
      (view) => {
        view.setFloat32(0, -1.25, true);
        view.setInt16(4, 321, true);
        view.setInt32(6, Math.round(-35.363261 * 10_000_000), true);
        view.setBigUint64(10, 42n, true);
      },
      18,
    ),
    recordPacket(
      201,
      (view) => {
        view.setInt32(0, Math.round(37.4221234 * 10_000_000), true);
        view.setInt32(4, Math.round(-122.0845678 * 10_000_000), true);
        view.setFloat32(8, 101.25, true);
      },
      12,
    ),
  );
}

function fmtPacket(type: number, name: string, format: string, columns: string): Uint8Array {
  const bytes = new Uint8Array(89);
  bytes[0] = HEADER[0];
  bytes[1] = HEADER[1];
  bytes[2] = FMT_TYPE;
  bytes[3] = type;
  bytes[4] = packetLengthFor(format);
  writeAscii(bytes, 5, 4, name);
  writeAscii(bytes, 9, 16, format);
  writeAscii(bytes, 25, 64, columns);
  return bytes;
}

function recordPacket(
  type: number,
  fill: (view: DataView) => void,
  bodyLength: number,
): Uint8Array {
  const bytes = new Uint8Array(3 + bodyLength);
  bytes[0] = HEADER[0];
  bytes[1] = HEADER[1];
  bytes[2] = type;
  fill(new DataView(bytes.buffer, bytes.byteOffset + 3, bodyLength));
  return bytes;
}

function packetLengthFor(format: string): number {
  let body = 0;
  for (const char of format) {
    switch (char) {
      case 'f':
      case 'L':
        body += 4;
        break;
      case 'h':
        body += 2;
        break;
      case 'Q':
        body += 8;
        break;
      default:
        throw new Error(`fixture char ${char} not supported`);
    }
  }
  return 3 + body;
}

function writeAscii(bytes: Uint8Array, offset: number, length: number, value: string): void {
  for (let i = 0; i < Math.min(length, value.length); i++) bytes[offset + i] = value.charCodeAt(i);
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function splitEvery(bytes: Uint8Array, size: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += size)
    chunks.push(bytes.slice(offset, offset + size));
  return chunks;
}
