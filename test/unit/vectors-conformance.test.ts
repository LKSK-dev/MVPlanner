/**
 * Codec conformance against the pymavlink reference vectors (task T1.1; gate per
 * spec plan/03 §3.7, plan/10 §10.2).
 *
 * For every non-`decodeOnly` record we encode `record.fields` with the record's
 * version + signing and assert the output hex equals `expectedHex`. For every
 * record (including `decodeOnly`) we decode `expectedHex` and assert the decoded
 * fields match `record.fields` — BigInt-aware for 64-bit fields, float32-aware
 * for `float` fields, string for `char[]`, and using the README's NaN/Inf
 * string convention.
 *
 * NOTE (placed alongside the conformance runner so it sits next to the data it
 * validates; vitest's `include` only globs `test/unit/**`, so the file lives
 * here rather than at `test/` to actually run in the gate).
 */
import { describe, expect, it } from 'vitest';
import type { DialectTable, FieldMeta, FieldValue, MessageMeta } from '../../src/contracts';
import { createMavCodec, type ParserOptions } from '../../src/mavlink/codec';
import commonJson from '../../src/mavlink/dialects/generated/common.json';
import apmJson from '../../src/mavlink/dialects/generated/ardupilotmega.json';
import v1Vectors from '../vectors/vectors-v1.json';
import v2Vectors from '../vectors/vectors-v2.json';
import signedVectors from '../vectors/vectors-signed.json';

interface VectorRecord {
  label: string;
  dialect: 'common' | 'ardupilotmega';
  msgName: string;
  msgId: number;
  crcExtra: number;
  version: 1 | 2;
  signed: boolean;
  sysid: number;
  compid: number;
  seq: number;
  fields: Record<string, unknown>;
  expectedHex: string;
  signing?: { keyHex: string; linkId: number; timestamp: number };
  decodeOnly?: boolean;
}

const common = commonJson as unknown as DialectTable;
const apm = apmJson as unknown as DialectTable;
const dialects: readonly DialectTable[] = [common, apm];
const codec = createMavCodec({ dialects });

const metaByName = new Map<string, MessageMeta>();
for (const d of dialects) {
  for (const m of Object.values(d.messages)) {
    if (!metaByName.has(m.name)) metaByName.set(m.name, m);
  }
}

const records: VectorRecord[] = [
  ...(v1Vectors as unknown as VectorRecord[]),
  ...(v2Vectors as unknown as VectorRecord[]),
  ...(signedVectors as unknown as VectorRecord[]),
];

function toBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function toHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function parseExpectedNumber(v: unknown): number {
  if (v === 'NaN') return NaN;
  if (v === 'Infinity') return Infinity;
  if (v === '-Infinity') return -Infinity;
  return Number(v);
}

function fieldMatches(meta: FieldMeta, decoded: FieldValue, expected: unknown): boolean {
  const type = meta.type;
  const isArray = meta.arrayLen !== undefined && meta.arrayLen > 0 && type !== 'char';

  if (type === 'char') return decoded === String(expected);

  if (isArray) {
    if (!Array.isArray(decoded) || !Array.isArray(expected) || decoded.length !== expected.length) {
      return false;
    }
    return decoded.every((d, i) => {
      const e = expected[i];
      if (type === 'float') {
        const fe = Math.fround(Number(e));
        return Object.is(fe, d) || fe === d;
      }
      return Number(d) === Number(e);
    });
  }

  if (type === 'uint64_t' || type === 'int64_t') {
    return typeof decoded === 'bigint' && decoded === BigInt(String(expected));
  }
  if (type === 'float') {
    const e = Math.fround(parseExpectedNumber(expected));
    return Object.is(e, decoded) || e === decoded;
  }
  if (type === 'double') {
    const e = parseExpectedNumber(expected);
    return Object.is(e, decoded) || e === decoded;
  }
  return Number(decoded) === Number(expected);
}

function encodeInput(r: VectorRecord): {
  name: string;
  fields: Record<string, unknown>;
  sysid: number;
  compid: number;
} {
  const fields: Record<string, unknown> = { ...r.fields };
  // pymavlink's heartbeat_encode hardcodes mavlink_version = WIRE_PROTOCOL_VERSION (3);
  // the vector omits it, so supply the protocol constant the oracle used.
  if (r.msgName === 'HEARTBEAT' && !('mavlink_version' in fields)) fields.mavlink_version = 3;
  return { name: r.msgName, fields, sysid: r.sysid, compid: r.compid };
}

function runEncode(r: VectorRecord): void {
  const opts = r.signed
    ? {
        version: r.version,
        seq: r.seq,
        signing: { enabled: true, key: toBytes(r.signing!.keyHex), linkId: r.signing!.linkId },
        timestamp: BigInt(r.signing!.timestamp),
      }
    : { version: r.version, seq: r.seq };
  const got = toHex(codec.encode(encodeInput(r), opts));
  expect(got).toBe(r.expectedHex);
}

function runDecode(r: VectorRecord): void {
  const meta = metaByName.get(r.msgName)!;
  const metaFields = new Map<string, FieldMeta>(meta.fields.map((f) => [f.name, f]));

  const parserOpts: ParserOptions = r.signed
    ? {
        dialects,
        signing: {
          enabled: true,
          key: toBytes(r.signing!.keyHex),
          linkId: r.signing!.linkId,
          allowUnsigned: false,
        },
      }
    : { dialects };

  const msgs = codec.parser(parserOpts).push(toBytes(r.expectedHex));
  expect(msgs).toHaveLength(1);
  const m = msgs[0]!;

  expect(m.name).toBe(r.msgName);
  expect(m.msgId).toBe(r.msgId);
  expect(m.sysid).toBe(r.sysid);
  expect(m.compid).toBe(r.compid);
  expect(m.seq).toBe(r.seq);
  expect(m.crcOk).toBe(true);
  if (r.signed) {
    expect(m.signed).toBe(true);
    expect(m.linkId).toBe(r.signing!.linkId);
  }
  expect(m.raw.length).toBe(r.expectedHex.length / 2);

  for (const [name, expected] of Object.entries(r.fields)) {
    const fmeta = metaFields.get(name)!;
    const decoded = m.fields[name];
    expect(decoded, `field ${name}`).not.toBeUndefined();
    expect(fieldMatches(fmeta, decoded as FieldValue, expected), `field ${name}`).toBe(true);
  }
}

describe('MAVLink codec conformance vs pymavlink vectors', () => {
  for (const r of records) {
    const fileTag = r.signed ? 'signed' : `v${r.version}`;

    if (!r.decodeOnly) {
      it(`[${fileTag}] encode ${r.label}`, () => runEncode(r));
    }
    it(`[${fileTag}] decode ${r.label}`, () => runDecode(r));
  }
});
