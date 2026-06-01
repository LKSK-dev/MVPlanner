/**
 * Public DataFlash decoder types (task T6.2; spec plan/04 §4.8, plan/07 §7.5).
 *
 * DataFlash values are decoded from ArduPilot FMT definitions. Integer fields are
 * numbers except 64-bit q/Q fields, which are bigint to avoid precision loss.
 */

/** A decoded scalar or fixed numeric array from a DataFlash record. */
export type DataFlashValue = number | string | bigint | readonly number[];

/** A decoded DataFlash log record. */
export interface DataFlashRecord {
  /** Numeric DataFlash message type byte. */
  readonly type: number;
  /** Four-character FMT message name, trimmed of NUL/padding. */
  readonly name: string;
  /** Byte offset of the packet header within the stream. */
  readonly offset: number;
  /** Total packet length in bytes, including 0xA3 0x95 and type. */
  readonly length: number;
  /** Decoded fields keyed by FMT column name. */
  readonly fields: Readonly<Record<string, DataFlashValue>>;
  /** Optional UNIT ids per field, when FMTU metadata is present. */
  readonly unitIds?: string;
  /** Optional MULT ids per field, when FMTU metadata is present. */
  readonly multIds?: string;
}

/** FMT-defined message schema. */
export interface DataFlashFormatDefinition {
  /** Numeric DataFlash message type byte described by this FMT record. */
  readonly type: number;
  /** Total packet length in bytes, including the 3-byte packet header. */
  readonly length: number;
  /** Four-character DataFlash message name. */
  readonly name: string;
  /** ArduPilot format string. */
  readonly format: string;
  /** Column names from FMT, split on commas and trimmed. */
  readonly columns: readonly string[];
}

/** UNIT metadata entry keyed by a one-byte unit id. */
export interface DataFlashUnitDefinition {
  readonly id: number;
  readonly label: string;
}

/** MULT metadata entry keyed by a one-byte multiplier id. */
export interface DataFlashMultiplierDefinition {
  readonly id: number;
  readonly multiplier: number;
}

/** Best-effort FMTU units/multipliers attached to one message type. */
export interface DataFlashFormatUnits {
  readonly type: number;
  readonly unitIds: string;
  readonly multIds: string;
}

/** Snapshot of UNIT/MULT/FMTU metadata known to the decoder. */
export interface DataFlashMetadata {
  readonly units: readonly DataFlashUnitDefinition[];
  readonly multipliers: readonly DataFlashMultiplierDefinition[];
  readonly formatUnits: readonly DataFlashFormatUnits[];
}

/** Message type index entry for field-tree and query-engine discovery. */
export interface DataFlashTypeInfo extends DataFlashFormatDefinition {
  /** Format character for each decoded FMT column. */
  readonly fieldFormats: readonly string[];
  /** Optional FMTU metadata for this type, when present. */
  readonly units?: DataFlashFormatUnits;
}

/** Decoder callback hooks. */
export interface DataFlashDecoderOptions {
  /** Called for each decoded non-FMT record. */
  readonly onRecord?: (record: DataFlashRecord) => void;
  /** Called when an FMT record defines or replaces a message schema. */
  readonly onFormat?: (format: DataFlashFormatDefinition) => void;
  /** Called when UNIT, MULT, or FMTU metadata changes. */
  readonly onMetadata?: (metadata: DataFlashMetadata) => void;
  /** Maximum retained carry-over bytes between chunks. Defaults to 1024. */
  readonly maxBufferBytes?: number;
}

/** Byte sources accepted by the pure streaming helpers. */
export type DataFlashByteSource = Iterable<Uint8Array> | AsyncIterable<Uint8Array> | Blob;
