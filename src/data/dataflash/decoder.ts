/**
 * Streaming ArduPilot DataFlash (.bin) decoder.
 *
 * Packets are resynchronised on the two-byte DataFlash header (0xA3 0x95). FMT
 * packets (type 128) define all later packet lengths and field layouts. The
 * decoder only retains a small carry-over buffer between chunks; callers should
 * feed file/Blob chunks rather than materialising whole logs.
 */
import type {
  DataFlashDecoderOptions,
  DataFlashFormatDefinition,
  DataFlashFormatUnits,
  DataFlashMetadata,
  DataFlashMultiplierDefinition,
  DataFlashRecord,
  DataFlashTypeInfo,
  DataFlashUnitDefinition,
  DataFlashValue,
} from './types';

const HEADER_0 = 0xa3;
const HEADER_1 = 0x95;
const HEADER_BYTES = 3;
const FMT_TYPE = 128;
const FMT_BODY_BYTES = 86;
const FMT_PACKET_BYTES = HEADER_BYTES + FMT_BODY_BYTES;
const DEFAULT_MAX_BUFFER_BYTES = 1024;

interface FieldDecoder {
  readonly code: string;
  readonly size: number;
  decode(view: DataView, offset: number): DataFlashValue;
}

interface CompiledFormat extends DataFlashFormatDefinition {
  readonly decoders: readonly FieldDecoder[];
  readonly bodyBytes: number;
}

/** Incremental DataFlash decoder with bounded carry-over buffering. */
export class DataFlashDecoder {
  private readonly onRecord?: ((record: DataFlashRecord) => void) | undefined;
  private readonly onFormat?: ((format: DataFlashFormatDefinition) => void) | undefined;
  private readonly onMetadata?: ((metadata: DataFlashMetadata) => void) | undefined;
  private readonly maxBufferBytes: number;
  private buffer = new Uint8Array(0);
  private streamOffset = 0;
  private readonly formats = new Map<number, CompiledFormat>();
  private readonly units = new Map<number, DataFlashUnitDefinition>();
  private readonly multipliers = new Map<number, DataFlashMultiplierDefinition>();
  private readonly formatUnits = new Map<number, DataFlashFormatUnits>();

  constructor(options: DataFlashDecoderOptions = {}) {
    this.onRecord = options.onRecord;
    this.onFormat = options.onFormat;
    this.onMetadata = options.onMetadata;
    this.maxBufferBytes = Math.max(
      FMT_PACKET_BYTES,
      options.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES,
    );
  }

  /** Feed the next byte chunk and return records decoded from this chunk. */
  feed(chunk: Uint8Array): readonly DataFlashRecord[] {
    if (chunk.byteLength === 0) return [];
    this.append(chunk);
    const records: DataFlashRecord[] = [];
    let pos = 0;

    while (pos < this.buffer.byteLength) {
      const header = findHeader(this.buffer, pos);
      if (header < 0) {
        const keep = this.buffer[this.buffer.byteLength - 1] === HEADER_0 ? 1 : 0;
        this.streamOffset += this.buffer.byteLength - keep;
        this.buffer =
          keep === 1 ? this.buffer.slice(this.buffer.byteLength - 1) : new Uint8Array(0);
        this.enforceBoundedBuffer();
        return records;
      }

      if (header > pos) {
        pos = header;
      }

      if (this.buffer.byteLength - pos < HEADER_BYTES) break;
      const type = this.buffer[pos + 2];
      if (type === undefined) break;
      const format = type === FMT_TYPE ? undefined : this.formats.get(type);
      const packetLength = type === FMT_TYPE ? FMT_PACKET_BYTES : format?.length;

      if (packetLength === undefined || packetLength < HEADER_BYTES) {
        // Unknown type before its FMT (or corrupt length): advance one byte and
        // resynchronise. This bounds memory even on garbage-prefixed logs.
        pos += 1;
        continue;
      }

      if (this.buffer.byteLength - pos < packetLength) break;
      const bodyStart = pos + HEADER_BYTES;
      const bodyEnd = pos + packetLength;
      const packetOffset = this.streamOffset + pos;
      const body = this.buffer.subarray(bodyStart, bodyEnd);

      if (type === FMT_TYPE) {
        const parsed = parseFmt(body);
        if (parsed !== undefined) {
          const compiled = compileFormat(parsed);
          this.formats.set(compiled.type, compiled);
          this.onFormat?.(parsed);
        }
      } else if (format !== undefined) {
        const record = decodeRecord(format, body, packetOffset);
        const units = this.formatUnits.get(record.type);
        const withUnits =
          units === undefined
            ? record
            : { ...record, unitIds: units.unitIds, multIds: units.multIds };
        records.push(withUnits);
        this.onRecord?.(withUnits);
        if (this.captureMetadata(withUnits)) this.onMetadata?.(this.getMetadata());
      }

      pos += packetLength;
    }

    if (pos > 0) {
      this.streamOffset += pos;
      this.buffer = this.buffer.slice(pos);
    }
    this.enforceBoundedBuffer();
    return records;
  }

  /** Drop any incomplete trailing packet. Call at end-of-file. */
  finish(): void {
    this.streamOffset += this.buffer.byteLength;
    this.buffer = new Uint8Array(0);
  }

  /** Current FMT-derived type index, sorted by numeric type. */
  getTypes(): readonly DataFlashTypeInfo[] {
    return [...this.formats.values()]
      .sort((a, b) => a.type - b.type)
      .map((fmt) => {
        const units = this.formatUnits.get(fmt.type);
        const base = {
          type: fmt.type,
          length: fmt.length,
          name: fmt.name,
          format: fmt.format,
          columns: fmt.columns,
          fieldFormats: fmt.decoders.map((d) => d.code),
        };
        return units === undefined ? base : { ...base, units };
      });
  }

  /** Current UNIT/MULT/FMTU metadata snapshot. */
  getMetadata(): DataFlashMetadata {
    return {
      units: [...this.units.values()].sort((a, b) => a.id - b.id),
      multipliers: [...this.multipliers.values()].sort((a, b) => a.id - b.id),
      formatUnits: [...this.formatUnits.values()].sort((a, b) => a.type - b.type),
    };
  }

  private append(chunk: Uint8Array): void {
    if (this.buffer.byteLength === 0) {
      this.buffer = chunk.slice();
      return;
    }
    const next = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
    next.set(this.buffer, 0);
    next.set(chunk, this.buffer.byteLength);
    this.buffer = next;
  }

  private enforceBoundedBuffer(): void {
    if (this.buffer.byteLength <= this.maxBufferBytes) return;
    const keepStart = this.buffer.byteLength - this.maxBufferBytes;
    this.streamOffset += keepStart;
    this.buffer = this.buffer.slice(keepStart);
  }

  private captureMetadata(record: DataFlashRecord): boolean {
    if (record.name === 'UNIT') return this.captureUnit(record.fields);
    if (record.name === 'MULT') return this.captureMultiplier(record.fields);
    if (record.name === 'FMTU') return this.captureFormatUnits(record.fields);
    return false;
  }

  private captureUnit(fields: Readonly<Record<string, DataFlashValue>>): boolean {
    const id = numberField(fields, ['Id', 'ID']);
    const label = stringField(fields, ['Label', 'Unit', 'Units']);
    if (id === undefined || label === undefined) return false;
    this.units.set(id, { id, label });
    return true;
  }

  private captureMultiplier(fields: Readonly<Record<string, DataFlashValue>>): boolean {
    const id = numberField(fields, ['Id', 'ID']);
    const multiplier = numberField(fields, ['Mult', 'Multiplier', 'Value']);
    if (id === undefined || multiplier === undefined) return false;
    this.multipliers.set(id, { id, multiplier });
    return true;
  }

  private captureFormatUnits(fields: Readonly<Record<string, DataFlashValue>>): boolean {
    const type = numberField(fields, ['Id', 'ID', 'Type']);
    const unitIds = stringField(fields, ['UnitIds', 'Units', 'Unit']);
    const multIds = stringField(fields, ['MultIds', 'Mults', 'Multipliers', 'Mult']);
    if (type === undefined || unitIds === undefined || multIds === undefined) return false;
    this.formatUnits.set(type, { type, unitIds, multIds });
    return true;
  }
}

function findHeader(bytes: Uint8Array, start: number): number {
  for (let i = start; i + 1 < bytes.byteLength; i++) {
    if (bytes[i] === HEADER_0 && bytes[i + 1] === HEADER_1) return i;
  }
  return -1;
}

function parseFmt(body: Uint8Array): DataFlashFormatDefinition | undefined {
  if (body.byteLength < FMT_BODY_BYTES) return undefined;
  const type = body[0];
  const length = body[1];
  if (type === undefined || length === undefined || length < HEADER_BYTES) return undefined;
  const name = readString(body, 2, 4);
  const format = readString(body, 6, 16);
  const columnsRaw = readString(body, 22, 64);
  const columns = columnsRaw
    .split(',')
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
  return { type, length, name, format, columns };
}

function compileFormat(format: DataFlashFormatDefinition): CompiledFormat {
  const decoders = [...format.format].map((code) => decoderFor(code));
  const bodyBytes = decoders.reduce((sum, decoder) => sum + decoder.size, 0);
  return { ...format, decoders, bodyBytes };
}

function decoderFor(code: string): FieldDecoder {
  switch (code) {
    case 'a':
      return {
        code,
        size: 64,
        decode: (view, offset): readonly number[] => {
          const out: number[] = [];
          for (let i = 0; i < 32; i++) out.push(view.getInt16(offset + i * 2, true));
          return out;
        },
      };
    case 'b':
      return { code, size: 1, decode: (view, offset): number => view.getInt8(offset) };
    case 'B':
    case 'M':
      return { code, size: 1, decode: (view, offset): number => view.getUint8(offset) };
    case 'h':
      return { code, size: 2, decode: (view, offset): number => view.getInt16(offset, true) };
    case 'H':
      return { code, size: 2, decode: (view, offset): number => view.getUint16(offset, true) };
    case 'i':
      return { code, size: 4, decode: (view, offset): number => view.getInt32(offset, true) };
    case 'I':
      return { code, size: 4, decode: (view, offset): number => view.getUint32(offset, true) };
    case 'f':
      return { code, size: 4, decode: (view, offset): number => view.getFloat32(offset, true) };
    case 'd':
      return { code, size: 8, decode: (view, offset): number => view.getFloat64(offset, true) };
    case 'n':
      return { code, size: 4, decode: (_view, offset): string => readViewString(_view, offset, 4) };
    case 'N':
      return {
        code,
        size: 16,
        decode: (_view, offset): string => readViewString(_view, offset, 16),
      };
    case 'Z':
      return {
        code,
        size: 64,
        decode: (_view, offset): string => readViewString(_view, offset, 64),
      };
    case 'c':
      return { code, size: 2, decode: (view, offset): number => view.getInt16(offset, true) / 100 };
    case 'C':
      return {
        code,
        size: 2,
        decode: (view, offset): number => view.getUint16(offset, true) / 100,
      };
    case 'e':
      return { code, size: 4, decode: (view, offset): number => view.getInt32(offset, true) / 100 };
    case 'E':
      return {
        code,
        size: 4,
        decode: (view, offset): number => view.getUint32(offset, true) / 100,
      };
    case 'L':
      return {
        code,
        size: 4,
        decode: (view, offset): number => view.getInt32(offset, true) / 10_000_000,
      };
    case 'q':
      return { code, size: 8, decode: (view, offset): bigint => view.getBigInt64(offset, true) };
    case 'Q':
      return { code, size: 8, decode: (view, offset): bigint => view.getBigUint64(offset, true) };
    default:
      throw new Error(`Unsupported DataFlash format character "${code}"`);
  }
}

function decodeRecord(format: CompiledFormat, body: Uint8Array, offset: number): DataFlashRecord {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const fields: Record<string, DataFlashValue> = {};
  let cursor = 0;
  for (let i = 0; i < format.decoders.length; i++) {
    const decoder = format.decoders[i];
    if (decoder === undefined) break;
    if (cursor + decoder.size > body.byteLength) break;
    const column = format.columns[i] ?? `field${i}`;
    fields[column] = decoder.decode(view, cursor);
    cursor += decoder.size;
  }
  return { type: format.type, name: format.name, offset, length: format.length, fields };
}

function readString(bytes: Uint8Array, offset: number, length: number): string {
  const end = Math.min(bytes.byteLength, offset + length);
  let out = '';
  for (let i = offset; i < end; i++) {
    const b = bytes[i];
    if (b === undefined || b === 0) break;
    out += String.fromCharCode(b);
  }
  return out.trim();
}

function readViewString(view: DataView, offset: number, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    const b = view.getUint8(offset + i);
    if (b === 0) break;
    out += String.fromCharCode(b);
  }
  return out.trim();
}

function numberField(
  fields: Readonly<Record<string, DataFlashValue>>,
  names: readonly string[],
): number | undefined {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function stringField(
  fields: Readonly<Record<string, DataFlashValue>>,
  names: readonly string[],
): string | undefined {
  for (const name of names) {
    const value = fields[name];
    if (typeof value === 'string') return value;
  }
  return undefined;
}
