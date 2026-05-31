/**
 * MAVLink FTP wire constants + payload (de)serialization for the
 * {@link import('./ftp-client').FtpClient} (task T3.1; spec plan/03 §3.4 FTP).
 *
 * MAVLink FTP rides inside `FILE_TRANSFER_PROTOCOL` (msg id 110). The message
 * carries `target_network`/`target_system`/`target_component` plus a fixed
 * 251-byte `payload` array. That payload is itself a little-endian struct:
 *
 * | offset | field            | type     |
 * | ------ | ---------------- | -------- |
 * | 0      | `seq`            | u16 LE   |
 * | 2      | `session`        | u8       |
 * | 3      | `opcode`         | u8       |
 * | 4      | `size`           | u8       |
 * | 5      | `req_opcode`     | u8       |
 * | 6      | `burst_complete` | u8       |
 * | 7      | `padding`        | u8       |
 * | 8      | `offset`         | u32 LE   |
 * | 12     | `data`           | u8[≤239] |
 *
 * `size` is the number of valid bytes in `data`. The message id is a protocol
 * constant (110) but is resolved from the bundled `common` dialect for a single
 * source of truth, mirroring the command microservice's constants.
 */
import type { DialectTable } from '../../../contracts';
import { commonDialect } from '../../dialects';

/** Outgoing/incoming MAVLink message name carrying the FTP payload. */
export const FTP_MSG_NAME = 'FILE_TRANSFER_PROTOCOL';

/** Resolve a message id by name from `d`, falling back to `fallback`. */
function msgId(d: DialectTable, name: string, fallback: number): number {
  for (const m of Object.values(d.messages)) if (m.name === name) return m.id;
  return fallback;
}

/** `FILE_TRANSFER_PROTOCOL` message id (110) — resolved from `common`. */
export const FTP_MSG_ID = msgId(commonDialect, FTP_MSG_NAME, 110);

/** Total `FILE_TRANSFER_PROTOCOL.payload` length in bytes. */
export const FTP_PAYLOAD_LEN = 251;
/** Bytes of header before the variable `data` region. */
export const FTP_HEADER_LEN = 12;
/** Maximum `data` bytes carried in one payload (251 − 12). */
export const FTP_MAX_DATA = FTP_PAYLOAD_LEN - FTP_HEADER_LEN;

/**
 * FTP opcodes used by the list/read paths (write/remove land in T5.11). `Ack`
 * and `Nak` are server responses; the rest are GCS requests. `BurstReadFile` is
 * defined for completeness but the M3 read path uses sequential `ReadFile`
 * (burst robustness is T5.11).
 */
export const FtpOpcode = {
  TerminateSession: 1,
  ResetSessions: 2,
  ListDirectory: 3,
  OpenFileRO: 4,
  ReadFile: 5,
  BurstReadFile: 15,
  Ack: 128,
  Nak: 129,
} as const;

/**
 * NAK error codes carried in `data[0]` of a {@link FtpOpcode.Nak} response.
 * `EndOfFile` is a normal terminator for read/list paging, not a failure.
 */
export const FtpNak = {
  None: 0,
  Fail: 1,
  FailErrno: 2,
  InvalidDataSize: 3,
  InvalidSession: 4,
  NoSessionsAvailable: 5,
  EndOfFile: 6,
  UnknownCommand: 7,
  FileExists: 8,
  FileProtected: 9,
  FileNotFound: 10,
} as const;

/** Human label for a NAK error code (diagnostics / error messages). */
export function nakName(code: number): string {
  for (const [name, value] of Object.entries(FtpNak)) if (value === code) return name;
  return `Nak(${code})`;
}

/** A decoded (or to-be-encoded) FTP payload struct. */
export interface FtpPayload {
  seq: number;
  session: number;
  opcode: number;
  /** Number of valid bytes in {@link data}. */
  size: number;
  reqOpcode: number;
  burstComplete: number;
  offset: number;
  /** The variable `data` region, already trimmed to {@link size} bytes. */
  data: Uint8Array;
}

/** Fields needed to build an outgoing request payload (`size` defaults to `data.length`). */
export interface FtpRequest {
  seq: number;
  session: number;
  opcode: number;
  offset: number;
  size?: number;
  data?: Uint8Array;
}

const EMPTY = new Uint8Array(0);

/**
 * Encode an FTP {@link FtpRequest} into the 251-element `number[]` expected by
 * the codec for the `FILE_TRANSFER_PROTOCOL.payload` array field. Trailing bytes
 * beyond `data` are zero-filled.
 */
export function encodePayload(req: FtpRequest): number[] {
  const data = req.data ?? EMPTY;
  const size = req.size ?? data.length;
  const buf = new ArrayBuffer(FTP_PAYLOAD_LEN);
  const dv = new DataView(buf);
  dv.setUint16(0, req.seq & 0xffff, true);
  dv.setUint8(2, req.session & 0xff);
  dv.setUint8(3, req.opcode & 0xff);
  dv.setUint8(4, size & 0xff);
  // req_opcode (5), burst_complete (6) and padding (7) are 0 on requests.
  dv.setUint32(8, req.offset >>> 0, true);
  const bytes = new Uint8Array(buf);
  bytes.set(data.subarray(0, FTP_MAX_DATA), FTP_HEADER_LEN);
  return Array.from(bytes);
}

/**
 * Decode the codec-provided `payload` array (a `number[]`, possibly shorter than
 * 251 after v2 truncation) into an {@link FtpPayload}, trimming `data` to the
 * declared `size`.
 */
export function decodePayload(raw: readonly number[]): FtpPayload {
  const bytes = new Uint8Array(FTP_PAYLOAD_LEN);
  for (let i = 0; i < FTP_PAYLOAD_LEN && i < raw.length; i++) bytes[i] = (raw[i] ?? 0) & 0xff;
  const dv = new DataView(bytes.buffer);
  const size = dv.getUint8(4);
  const dataLen = Math.min(size, FTP_MAX_DATA);
  return {
    seq: dv.getUint16(0, true),
    session: dv.getUint8(2),
    opcode: dv.getUint8(3),
    size,
    reqOpcode: dv.getUint8(5),
    burstComplete: dv.getUint8(6),
    offset: dv.getUint32(8, true),
    data: bytes.slice(FTP_HEADER_LEN, FTP_HEADER_LEN + dataLen),
  };
}

/** Read a little-endian u32 from the first 4 bytes of `data` (0 if too short). */
export function readU32LE(data: Uint8Array): number {
  if (data.byteLength < 4) return 0;
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);
}
