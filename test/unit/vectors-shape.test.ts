/**
 * Shape-sanity checks for the committed MAVLink reference vectors (task T1.3).
 *
 * SCOPE: this suite validates the SHAPE of the pymavlink-generated oracle data
 * only — required keys are present, `expectedHex` is valid hex, and its byte
 * length matches the v1/v2(+signing) framing implied by its own header bytes.
 * It deliberately does NOT run the project's TypeScript codec: the codec-vs-
 * vectors conformance runner is owned by T1.1 and must stay separate so the
 * oracle remains independent of the implementation it validates.
 */
import { describe, expect, it } from 'vitest';
import v1Vectors from '../vectors/vectors-v1.json';
import v2Vectors from '../vectors/vectors-v2.json';
import signedVectors from '../vectors/vectors-signed.json';
import manifest from '../vectors/manifest.json';

interface VectorRecord {
  label: string;
  dialect: string;
  msgName: string;
  msgId: number;
  crcExtra: number;
  version: number;
  signed: boolean;
  sysid: number;
  compid: number;
  seq: number;
  fields: Record<string, unknown>;
  expectedHex: string;
  signing?: { keyHex: string; linkId: number; timestamp: number };
  decodeOnly?: boolean;
}

const v1 = v1Vectors as unknown as VectorRecord[];
const v2 = v2Vectors as unknown as VectorRecord[];
const signed = signedVectors as unknown as VectorRecord[];
const all: VectorRecord[] = [...v1, ...v2, ...signed];

const REQUIRED_KEYS: (keyof VectorRecord)[] = [
  'label',
  'dialect',
  'msgName',
  'msgId',
  'crcExtra',
  'version',
  'signed',
  'sysid',
  'compid',
  'seq',
  'fields',
  'expectedHex',
];

function hexToBytes(hex: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    out.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return out;
}

function byteAt(bytes: number[], i: number): number {
  const b = bytes[i];
  if (b === undefined) throw new Error(`byte ${i} out of range`);
  return b;
}

describe('reference vectors: files load and are non-empty', () => {
  it('has vectors in every file', () => {
    expect(v1.length).toBeGreaterThan(0);
    expect(v2.length).toBeGreaterThan(0);
    expect(signed.length).toBeGreaterThan(0);
  });

  it('manifest counts match the actual record counts', () => {
    const counts = manifest.counts as {
      v1: number;
      v2Unsigned: number;
      v2Signed: number;
      decodeOnly: number;
      total: number;
    };
    expect(counts.v1).toBe(v1.length);
    expect(counts.v2Signed).toBe(signed.length);
    expect(counts.v2Unsigned).toBe(v2.filter((r) => !r.signed).length);
    expect(counts.decodeOnly).toBe(v2.filter((r) => r.decodeOnly).length);
    expect(counts.total).toBe(all.length);
  });
});

describe('reference vectors: per-record shape', () => {
  it('every record carries all required keys with correct types', () => {
    for (const rec of all) {
      for (const key of REQUIRED_KEYS) {
        expect(rec[key], `${rec.label}: missing ${String(key)}`).not.toBeUndefined();
      }
      expect(typeof rec.label).toBe('string');
      expect(typeof rec.dialect).toBe('string');
      expect(typeof rec.msgName).toBe('string');
      expect(Number.isInteger(rec.msgId)).toBe(true);
      expect(Number.isInteger(rec.crcExtra)).toBe(true);
      expect([1, 2]).toContain(rec.version);
      expect(typeof rec.signed).toBe('boolean');
      expect(Number.isInteger(rec.sysid)).toBe(true);
      expect(Number.isInteger(rec.compid)).toBe(true);
      expect(Number.isInteger(rec.seq)).toBe(true);
      expect(typeof rec.fields).toBe('object');
      expect(rec.fields).not.toBeNull();
      expect(typeof rec.expectedHex).toBe('string');
    }
  });

  it('expectedHex is valid, even-length, lowercase hex', () => {
    for (const rec of all) {
      expect(rec.expectedHex, `${rec.label}: hex format`).toMatch(/^[0-9a-f]+$/);
      expect(rec.expectedHex.length % 2, `${rec.label}: even length`).toBe(0);
    }
  });

  it('signed records only exist in v2 and carry deterministic signing params', () => {
    for (const rec of v1) expect(rec.signed).toBe(false);
    for (const rec of signed) {
      expect(rec.version).toBe(2);
      expect(rec.signed).toBe(true);
      expect(rec.signing).toBeDefined();
      expect(rec.signing?.keyHex).toMatch(/^[0-9a-f]{64}$/);
      expect(Number.isInteger(rec.signing?.linkId)).toBe(true);
      expect(Number.isInteger(rec.signing?.timestamp)).toBe(true);
    }
  });

  it('decodeOnly markers only appear on truncated v2 frames', () => {
    for (const rec of v2.filter((r) => r.decodeOnly)) {
      expect(rec.version).toBe(2);
      expect(rec.signed).toBe(false);
    }
  });
});

describe('reference vectors: framing length matches header', () => {
  it('every frame length and header fields agree with its declared version/signed', () => {
    for (const rec of all) {
      const bytes = hexToBytes(rec.expectedHex);
      const magic = byteAt(bytes, 0);
      const payloadLen = byteAt(bytes, 1);

      if (rec.version === 1) {
        expect(magic, `${rec.label}: v1 magic`).toBe(0xfe);
        expect(rec.signed, `${rec.label}: v1 never signed`).toBe(false);
        // v1 frame = magic+len+seq+sysid+compid+msgid (6) + payload + crc(2)
        expect(bytes.length, `${rec.label}: v1 length`).toBe(8 + payloadLen);
        expect(byteAt(bytes, 2)).toBe(rec.seq);
        expect(byteAt(bytes, 3)).toBe(rec.sysid);
        expect(byteAt(bytes, 4)).toBe(rec.compid);
        expect(byteAt(bytes, 5)).toBe(rec.msgId);
      } else {
        expect(magic, `${rec.label}: v2 magic`).toBe(0xfd);
        const incompat = byteAt(bytes, 2);
        const signedFlag = (incompat & 0x01) === 0x01;
        expect(signedFlag, `${rec.label}: signed flag vs record`).toBe(rec.signed);
        const sig = rec.signed ? 13 : 0;
        // v2 frame = 10-byte header + payload + crc(2) [+ 13 signing]
        expect(bytes.length, `${rec.label}: v2 length`).toBe(12 + payloadLen + sig);
        expect(byteAt(bytes, 4)).toBe(rec.seq);
        expect(byteAt(bytes, 5)).toBe(rec.sysid);
        expect(byteAt(bytes, 6)).toBe(rec.compid);
        const msgId = byteAt(bytes, 7) | (byteAt(bytes, 8) << 8) | (byteAt(bytes, 9) << 16);
        expect(msgId, `${rec.label}: v2 msgId`).toBe(rec.msgId);
      }
    }
  });
});

describe('reference vectors: representative coverage', () => {
  const names = new Set(all.map((r) => r.msgName));

  it('covers the required common/ardupilotmega message set', () => {
    for (const name of [
      'HEARTBEAT',
      'SYS_STATUS',
      'GPS_RAW_INT',
      'ATTITUDE',
      'GLOBAL_POSITION_INT',
      'COMMAND_LONG',
      'COMMAND_INT',
      'PARAM_VALUE',
      'STATUSTEXT',
      'MISSION_ITEM_INT',
    ]) {
      expect(names.has(name), `missing ${name}`).toBe(true);
    }
  });

  it('includes a numeric-array message and a v2-extension message', () => {
    expect(names.has('GPS_STATUS')).toBe(true);
    expect(names.has('GPS_RAW_INT') || names.has('MEMINFO')).toBe(true);
  });

  it('includes both ardupilotmega-dialect and signed vectors', () => {
    expect(all.some((r) => r.dialect === 'ardupilotmega')).toBe(true);
    expect(signed.length).toBeGreaterThan(0);
  });
});
