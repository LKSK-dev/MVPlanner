/**
 * Field-level (de)serialization for MAVLink payloads (spec plan/03 §3.1–§3.2).
 *
 * Fields are packed/unpacked in the WIRE order supplied by the dialect table
 * ({@link MessageMeta.fields}), little-endian per type. Arrays repeat
 * `arrayLen` elements; `char` arrays are ASCII, zero-padded on encode and
 * NUL-trimmed on decode. 64-bit integers map to `bigint`; everything else maps
 * to `number` / `number[]` / `string`, matching the `FieldValue` union in the
 * frozen `src/contracts/mavlink.ts`.
 */
import type { FieldMeta, FieldValue, MessageMeta } from '../../contracts';

/** Thrown on malformed encode input or an unsupported field type. */
export class MavCodecError extends Error {
  override name = 'MavCodecError';
}

type FieldKind =
  | 'u8'
  | 'i8'
  | 'u16'
  | 'i16'
  | 'u32'
  | 'i32'
  | 'u64'
  | 'i64'
  | 'f32'
  | 'f64'
  | 'char';

interface TypeInfo {
  kind: FieldKind;
  size: number;
}

const TYPE_INFO: Record<string, TypeInfo> = {
  uint8_t: { kind: 'u8', size: 1 },
  int8_t: { kind: 'i8', size: 1 },
  char: { kind: 'char', size: 1 },
  uint16_t: { kind: 'u16', size: 2 },
  int16_t: { kind: 'i16', size: 2 },
  uint32_t: { kind: 'u32', size: 4 },
  int32_t: { kind: 'i32', size: 4 },
  float: { kind: 'f32', size: 4 },
  uint64_t: { kind: 'u64', size: 8 },
  int64_t: { kind: 'i64', size: 8 },
  double: { kind: 'f64', size: 8 },
};

function typeInfo(type: string): TypeInfo {
  const info = TYPE_INFO[type];
  if (info === undefined) {
    throw new MavCodecError(`unsupported MAVLink field type: ${type}`);
  }
  return info;
}

/** Number of array elements for a field (1 for non-array scalars). */
function elementCount(field: FieldMeta): number {
  return field.arrayLen !== undefined && field.arrayLen > 0 ? field.arrayLen : 1;
}

/** Total wire size in bytes of a single field (including its array length). */
export function fieldSize(field: FieldMeta): number {
  return typeInfo(field.type).size * elementCount(field);
}

/**
 * Payload length in bytes for `fields[0..count)` (the field slice to encode).
 * Used to size the base (v1) and full (v2) payload buffers.
 */
export function payloadLength(fields: readonly FieldMeta[], count: number): number {
  let total = 0;
  for (let i = 0; i < count; i++) {
    total += fieldSize(fields[i] as FieldMeta);
  }
  return total;
}

/** Coerce an unknown encode input to a `number` (accepts numeric strings). */
function toNumber(value: unknown, field: FieldMeta): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    if (value === 'NaN') return NaN;
    if (value === 'Infinity') return Infinity;
    if (value === '-Infinity') return -Infinity;
    const n = Number(value);
    if (!Number.isNaN(n) || value.trim() === 'NaN') return n;
  }
  throw new MavCodecError(`field ${field.name}: expected number, got ${typeof value}`);
}

/** Coerce an unknown encode input to a `bigint` (accepts number|string). */
function toBigInt(value: unknown, field: FieldMeta): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') {
    try {
      return BigInt(value);
    } catch {
      throw new MavCodecError(`field ${field.name}: invalid 64-bit value "${value}"`);
    }
  }
  throw new MavCodecError(`field ${field.name}: expected bigint, got ${typeof value}`);
}

function writeScalar(
  dv: DataView,
  offset: number,
  kind: FieldKind,
  value: unknown,
  field: FieldMeta,
): void {
  switch (kind) {
    case 'u8':
    case 'char':
      dv.setUint8(offset, toNumber(value, field) & 0xff);
      break;
    case 'i8':
      dv.setInt8(offset, toNumber(value, field));
      break;
    case 'u16':
      dv.setUint16(offset, toNumber(value, field) & 0xffff, true);
      break;
    case 'i16':
      dv.setInt16(offset, toNumber(value, field), true);
      break;
    case 'u32':
      dv.setUint32(offset, toNumber(value, field) >>> 0, true);
      break;
    case 'i32':
      dv.setInt32(offset, toNumber(value, field) | 0, true);
      break;
    case 'f32':
      dv.setFloat32(offset, toNumber(value, field), true);
      break;
    case 'f64':
      dv.setFloat64(offset, toNumber(value, field), true);
      break;
    case 'u64':
      dv.setBigUint64(offset, BigInt.asUintN(64, toBigInt(value, field)), true);
      break;
    case 'i64':
      dv.setBigInt64(offset, BigInt.asIntN(64, toBigInt(value, field)), true);
      break;
  }
}

/**
 * Pack one field's value into `dv` starting at `offset`.
 *
 * @returns the offset immediately after the written field
 */
export function packField(dv: DataView, offset: number, field: FieldMeta, value: unknown): number {
  const { kind, size } = typeInfo(field.type);
  const count = elementCount(field);
  const isArray = field.arrayLen !== undefined && field.arrayLen > 0;

  if (kind === 'char' && isArray) {
    const text = value === undefined || value === null ? '' : String(value);
    for (let i = 0; i < count; i++) {
      dv.setUint8(offset + i, i < text.length ? text.charCodeAt(i) & 0xff : 0);
    }
    return offset + size * count;
  }

  if (isArray) {
    const arr = Array.isArray(value) ? (value as unknown[]) : [];
    for (let i = 0; i < count; i++) {
      writeScalar(dv, offset + i * size, kind, i < arr.length ? arr[i] : 0, field);
    }
    return offset + size * count;
  }

  writeScalar(dv, offset, kind, value === undefined ? 0 : value, field);
  return offset + size;
}

function readScalar(dv: DataView, offset: number, kind: FieldKind): number | bigint {
  switch (kind) {
    case 'u8':
    case 'char':
      return dv.getUint8(offset);
    case 'i8':
      return dv.getInt8(offset);
    case 'u16':
      return dv.getUint16(offset, true);
    case 'i16':
      return dv.getInt16(offset, true);
    case 'u32':
      return dv.getUint32(offset, true);
    case 'i32':
      return dv.getInt32(offset, true);
    case 'f32':
      return dv.getFloat32(offset, true);
    case 'f64':
      return dv.getFloat64(offset, true);
    case 'u64':
      return dv.getBigUint64(offset, true);
    case 'i64':
      return dv.getBigInt64(offset, true);
  }
}

/**
 * Unpack one field's value from `dv` starting at `offset`.
 *
 * @returns the decoded {@link FieldValue} and the offset after the field
 */
export function unpackField(
  dv: DataView,
  offset: number,
  field: FieldMeta,
): { value: FieldValue; next: number } {
  const { kind, size } = typeInfo(field.type);
  const count = elementCount(field);
  const isArray = field.arrayLen !== undefined && field.arrayLen > 0;

  if (kind === 'char') {
    let text = '';
    for (let i = 0; i < count; i++) {
      const c = dv.getUint8(offset + i);
      if (c === 0) break; // C-string: stop at first NUL, ignore trailing bytes
      text += String.fromCharCode(c);
    }
    return { value: text, next: offset + size * count };
  }

  if (isArray) {
    const arr: number[] = [];
    for (let i = 0; i < count; i++) {
      const v = readScalar(dv, offset + i * size, kind);
      arr.push(typeof v === 'bigint' ? Number(v) : v);
    }
    return { value: arr, next: offset + size * count };
  }

  return { value: readScalar(dv, offset, kind), next: offset + size };
}

/**
 * The field slice that participates in a given framing version: v1 omits
 * MAVLink v2 extension fields (`index >= extensionIndex`); v2 includes them.
 */
export function fieldCount(meta: MessageMeta, version: 1 | 2): number {
  if (version === 2 || meta.extensionIndex === undefined) return meta.fields.length;
  return meta.extensionIndex;
}
