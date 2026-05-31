/**
 * MAVLink codec & type seams (impl 02 §2.3; spec plan/03 §3.1–§3.3). FROZEN.
 */

export interface FieldMeta {
  name: string;
  type: string;
  arrayLen?: number;
  enum?: string;
  units?: string;
}

export interface MessageMeta {
  id: number;
  name: string;
  crcExtra: number;
  fields: FieldMeta[];
  /** Index in `fields` at which MAVLink v2 extension fields begin. */
  extensionIndex?: number;
}

export interface EnumEntryMeta {
  value: number;
  name: string;
  description?: string;
  /** MAV_CMD param labels, where applicable. */
  params?: string[];
}

export interface DialectTable {
  name: string;
  messages: Record<number, MessageMeta>;
  /** Enum name -> entries (includes MAV_CMD metadata). */
  enums: Record<string, EnumEntryMeta[]>;
}

export type FieldValue = number | bigint | number[] | string;

export interface DecodedMessage {
  sysid: number;
  compid: number;
  seq: number;
  msgId: number;
  name: string;
  fields: Record<string, FieldValue>;
  crcOk: boolean;
  signed: boolean;
  linkId?: number;
  rxTimeUs: number;
  /** Raw frame bytes — used for tlog recording (spec plan/07 §7.4). */
  raw: Uint8Array;
}

export interface SigningConfig {
  enabled: boolean;
  key?: Uint8Array;
  linkId?: number;
  allowUnsigned?: boolean;
}

export interface MavParser {
  /** Streaming, resync-safe. */
  push(bytes: Uint8Array): DecodedMessage[];
  reset(): void;
}

export interface MessageInput {
  name: string;
  fields: Record<string, unknown>;
  sysid: number;
  compid: number;
}

export interface MavCodec {
  parser(opts: { dialects: DialectTable[]; signing?: SigningConfig }): MavParser;
  encode(input: MessageInput, opts: { version: 1 | 2; signing?: SigningConfig }): Uint8Array;
}
