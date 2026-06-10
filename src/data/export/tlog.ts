/**
 * MAVLink tlog CSV conversion utilities (T6.7; spec plan/04 §4.7 and
 * plan/07 §7.4). tlogs are split with the replay parser, decoded with the
 * built-in MAVLink dialects, and serialized either per message type or as a
 * flattened selected-field table.
 */
import type { DecodedMessage, DialectTable } from '../../contracts';
import { createMavCodec } from '../../mavlink/codec';
import { BUILTIN_DIALECTS } from '../../mavlink/dialects';
import { parseTlog } from '../../transport/replay';
import { escapeCsvCell } from './csv';

/** Input accepted by tlog export functions. */
export type TlogInput = ArrayBuffer | Uint8Array;

/** Shared tlog decode options. */
export interface TlogDecodeOptions {
  /** Dialects used to decode frames; defaults to MVPlanner's built-in tables. */
  readonly dialects?: readonly DialectTable[];
}

/** A decoded MAVLink message paired with its tlog timestamp. */
export interface ExtractedTlogMessage {
  /** Raw tlog timestamp in microseconds since the Unix epoch. */
  readonly timeTicks: bigint;
  /** Relative time in microseconds from the first tlog frame. */
  readonly timeUs: number;
  /** The decoded MAVLink message. */
  readonly message: DecodedMessage;
}

/** Message type and field summary present in a tlog. */
export interface TlogMessageTypeInfo {
  /** MAVLink message name. */
  readonly name: string;
  /** Numeric MAVLink message id. */
  readonly msgId: number;
  /** Number of decoded messages of this type. */
  readonly count: number;
  /** Field names observed for this message type, in decode order. */
  readonly fields: readonly string[];
  /** First relative timestamp for this message type. */
  readonly firstTimeUs: number;
  /** Last relative timestamp for this message type. */
  readonly lastTimeUs: number;
}

/** One per-message CSV output. */
export interface TlogCsvFile {
  /** Suggested CSV filename, e.g. `HEARTBEAT.csv`. */
  readonly name: string;
  /** MAVLink message name. */
  readonly messageName: string;
  /** Numeric MAVLink message id. */
  readonly msgId: number;
  /** Number of rows emitted after the header. */
  readonly count: number;
  /** CSV text. */
  readonly csv: string;
}

/** Per-message tlog CSV conversion options. */
export interface PerMessageTlogCsvOptions extends TlogDecodeOptions {
  /** Conversion mode. Defaults to per-message CSV files. */
  readonly mode?: 'per-message';
  /** Optional allow-list of MAVLink message names to export. */
  readonly messageNames?: readonly string[];
}

/** One selected field in flattened tlog CSV output. */
export interface TlogFieldSelection {
  /** MAVLink message name, e.g. `SYSTEM_TIME`. */
  readonly message: string;
  /** MAVLink field name, e.g. `time_boot_ms`. */
  readonly field: string;
  /** Optional CSV column header. Defaults to `MESSAGE.field`. */
  readonly header?: string;
}

/** Flattened selected-field tlog CSV conversion options. */
export interface FlatTlogCsvOptions extends TlogDecodeOptions {
  /** Conversion mode for a single flattened CSV table. */
  readonly mode: 'flat';
  /** Fields to include, as objects or `MESSAGE.field` strings. */
  readonly fields: readonly (TlogFieldSelection | string)[];
}

interface MutableTypeInfo {
  name: string;
  msgId: number;
  count: number;
  fields: string[];
  fieldSet: Set<string>;
  firstTimeUs: number;
  lastTimeUs: number;
}

interface MessageBuffer {
  info: TlogMessageTypeInfo;
  lines: string[];
  count: number;
}

interface NormalizedFieldSelection {
  message: string;
  field: string;
  header: string;
}

function dialectsFor(options: TlogDecodeOptions | undefined): readonly DialectTable[] {
  return options?.dialects ?? BUILTIN_DIALECTS;
}

function appendCsvLine(lines: string[], values: readonly unknown[]): void {
  lines.push(values.map((value) => escapeCsvCell(value)).join(','));
}

function infoKey(message: DecodedMessage): string {
  return `${message.msgId}:${message.name}`;
}

function getOrCreateInfo(
  infos: Map<string, MutableTypeInfo>,
  message: DecodedMessage,
  timeUs: number,
): MutableTypeInfo {
  const key = infoKey(message);
  const existing = infos.get(key);
  if (existing !== undefined) return existing;

  const created: MutableTypeInfo = {
    name: message.name,
    msgId: message.msgId,
    count: 0,
    fields: [],
    fieldSet: new Set<string>(),
    firstTimeUs: timeUs,
    lastTimeUs: timeUs,
  };
  infos.set(key, created);
  return created;
}

function snapshotInfo(info: MutableTypeInfo): TlogMessageTypeInfo {
  return {
    name: info.name,
    msgId: info.msgId,
    count: info.count,
    fields: [...info.fields],
    firstTimeUs: info.firstTimeUs,
    lastTimeUs: info.lastTimeUs,
  };
}

function selectedNameSet(
  messageNames: readonly string[] | undefined,
): ReadonlySet<string> | undefined {
  return messageNames === undefined ? undefined : new Set(messageNames);
}

function normalizeSelection(selection: TlogFieldSelection | string): NormalizedFieldSelection {
  if (typeof selection !== 'string') {
    return {
      message: selection.message,
      field: selection.field,
      header: selection.header ?? `${selection.message}.${selection.field}`,
    };
  }

  const dot = selection.indexOf('.');
  if (dot <= 0 || dot === selection.length - 1) {
    throw new Error(`Invalid tlog field selection "${selection}"; expected MESSAGE.field`);
  }
  const message = selection.slice(0, dot);
  const field = selection.slice(dot + 1);
  return { message, field, header: selection };
}

/**
 * Decode messages from a tlog while preserving the tlog timestamp for each raw
 * frame. Frames that cannot be decoded by the selected dialects are skipped.
 */
export function* extractMessageStream(
  input: TlogInput,
  options?: TlogDecodeOptions,
): IterableIterator<ExtractedTlogMessage> {
  const dialects = dialectsFor(options);
  const parser = createMavCodec({ dialects }).parser({ dialects });

  for (const frame of parseTlog(input)) {
    const messages = parser.push(frame.bytes);
    for (const message of messages) {
      yield { timeTicks: frame.timeTicks, timeUs: frame.timeUs, message };
    }
  }
}

/**
 * List the MAVLink message types and fields present in a tlog. This is intended
 * for UI field pickers before the user chooses what to export.
 */
export function listTlogMessageTypes(
  input: TlogInput,
  options?: TlogDecodeOptions,
): TlogMessageTypeInfo[] {
  const infos = new Map<string, MutableTypeInfo>();

  for (const item of extractMessageStream(input, options)) {
    const info = getOrCreateInfo(infos, item.message, item.timeUs);
    info.count += 1;
    info.lastTimeUs = item.timeUs;
    for (const field of Object.keys(item.message.fields)) {
      if (!info.fieldSet.has(field)) {
        info.fieldSet.add(field);
        info.fields.push(field);
      }
    }
  }

  return [...infos.values()].map((info) => snapshotInfo(info));
}

function perMessageTlogToCsv(input: TlogInput, options?: PerMessageTlogCsvOptions): TlogCsvFile[] {
  const selected = selectedNameSet(options?.messageNames);
  const infos = listTlogMessageTypes(input, options).filter(
    (info) => selected === undefined || selected.has(info.name),
  );
  const buffers = new Map<string, MessageBuffer>();

  for (const info of infos) {
    const lines: string[] = [];
    appendCsvLine(lines, ['time_us', 'time_ticks', 'sysid', 'compid', 'seq', ...info.fields]);
    buffers.set(`${info.msgId}:${info.name}`, { info, lines, count: 0 });
  }

  for (const item of extractMessageStream(input, options)) {
    const buffer = buffers.get(infoKey(item.message));
    if (buffer === undefined) continue;

    appendCsvLine(buffer.lines, [
      item.timeUs,
      item.timeTicks,
      item.message.sysid,
      item.message.compid,
      item.message.seq,
      ...buffer.info.fields.map((field) => item.message.fields[field]),
    ]);
    buffer.count += 1;
  }

  return [...buffers.values()].map((buffer) => ({
    name: `${buffer.info.name}.csv`,
    messageName: buffer.info.name,
    msgId: buffer.info.msgId,
    count: buffer.count,
    csv: `${buffer.lines.join('\n')}\n`,
  }));
}

function flatTlogToCsv(input: TlogInput, options: FlatTlogCsvOptions): string {
  const fields = options.fields.map((selection) => normalizeSelection(selection));
  const header = ['time_us', 'time_ticks', 'message', ...fields.map((field) => field.header)];
  const lines: string[] = [];
  appendCsvLine(lines, header);

  for (const item of extractMessageStream(input, options)) {
    const hasSelectedValue = fields.some(
      (field) =>
        field.message === item.message.name && item.message.fields[field.field] !== undefined,
    );
    if (!hasSelectedValue) continue;

    appendCsvLine(lines, [
      item.timeUs,
      item.timeTicks,
      item.message.name,
      ...fields.map((field) =>
        field.message === item.message.name ? item.message.fields[field.field] : undefined,
      ),
    ]);
  }

  return `${lines.join('\n')}\n`;
}

/** Convert a tlog to per-message CSV files. */
export function tlogToCsv(input: TlogInput, options?: PerMessageTlogCsvOptions): TlogCsvFile[];
/** Convert a tlog to one flattened selected-field CSV. */
export function tlogToCsv(input: TlogInput, options: FlatTlogCsvOptions): string;
export function tlogToCsv(
  input: TlogInput,
  options?: PerMessageTlogCsvOptions | FlatTlogCsvOptions,
): TlogCsvFile[] | string {
  if (options?.mode === 'flat') return flatTlogToCsv(input, options);
  return perMessageTlogToCsv(input, options);
}
