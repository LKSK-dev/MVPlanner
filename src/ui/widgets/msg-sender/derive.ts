/**
 * Pure metadata derivation for the MAVLink message / command sender.
 *
 * These helpers are deliberately DOM-free and are covered by unit tests: they
 * turn a dialect's `MessageMeta` / `MAV_CMD` enum metadata into concrete editor
 * fields, including enum dropdown options and MAV_CMD param labels.
 */
import type { DialectTable, EnumEntryMeta, FieldMeta, MessageMeta } from '../../../contracts';
import type {
  CommandChoice,
  FieldEditorSpec,
  FieldEnumOption,
  MessageChoice,
  SenderChoice,
} from './types';

const MAV_CMD_ENUM = 'MAV_CMD';
const COMMAND_PARAM_COUNT = 7;

/** Build searchable picker entries for all messages and MAV_CMDs in `dialects`. */
export function buildSenderChoices(dialects: readonly DialectTable[]): readonly SenderChoice[] {
  return [...buildMessageChoices(dialects), ...buildCommandChoices(dialects)];
}

/** Build searchable picker entries for every message in every supplied dialect. */
export function buildMessageChoices(dialects: readonly DialectTable[]): readonly MessageChoice[] {
  const out: MessageChoice[] = [];
  for (const dialect of dialects) {
    const messages = Object.values(dialect.messages).sort((a, b) => a.id - b.id);
    for (const meta of messages) {
      const label = `${meta.name} (#${meta.id}, ${dialect.name})`;
      out.push({
        kind: 'message',
        id: `message:${dialect.name}:${meta.name}`,
        label,
        searchText: `${label} ${meta.id}`.toLowerCase(),
        dialect,
        meta,
      });
    }
  }
  return out;
}

/** Build searchable picker entries for every distinct MAV_CMD in the dialect set. */
export function buildCommandChoices(dialects: readonly DialectTable[]): readonly CommandChoice[] {
  const out: CommandChoice[] = [];
  const seen = new Set<number>();
  for (const dialect of dialects) {
    const entries = dialect.enums[MAV_CMD_ENUM] ?? [];
    for (const entry of entries) {
      if (seen.has(entry.value)) continue;
      seen.add(entry.value);
      const label = `${entry.name} (${entry.value})`;
      out.push({
        kind: 'command',
        id: `command:${entry.value}`,
        label,
        searchText: `${label} ${entry.description ?? ''}`.toLowerCase(),
        dialect,
        entry,
      });
    }
  }
  return out.sort((a, b) => a.entry.value - b.entry.value);
}

/** Resolve editor field specs for one MAVLink message. */
export function messageFieldSpecs(
  dialect: DialectTable,
  message: MessageMeta,
): readonly FieldEditorSpec[] {
  return message.fields.map((field) => specFromField(dialect, field));
}

/** Resolve editor field specs for one MAV_CMD entry. */
export function commandFieldSpecs(
  dialect: DialectTable,
  command: EnumEntryMeta,
): readonly FieldEditorSpec[] {
  const specs: FieldEditorSpec[] = [];
  for (let i = 0; i < COMMAND_PARAM_COUNT; i++) {
    const name = `param${i + 1}`;
    const label = commandParamLabel(command, i, name);
    specs.push({
      name,
      label,
      type: 'float',
      unused: isUnusedCommandParam(command, i),
      ...enumSpecForCommandParam(dialect, command, i, label),
    });
  }
  specs.push(commandAxisSpec(dialect, command, 'x', 4));
  specs.push(commandAxisSpec(dialect, command, 'y', 5));
  specs.push(commandAxisSpec(dialect, command, 'z', 6));
  return specs;
}

/** Filter picker choices using a whitespace-trimmed, case-insensitive query. */
export function filterSenderChoices(
  choices: readonly SenderChoice[],
  query: string,
): readonly SenderChoice[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return choices;
  return choices.filter((choice) => choice.searchText.includes(q));
}

/** Default raw editor value for one spec. */
export function defaultRawValue(spec: FieldEditorSpec): string {
  if (spec.enumOptions !== undefined && spec.enumOptions.length > 0) {
    const first = spec.enumOptions[0];
    return first === undefined ? '0' : String(first.value);
  }
  if (spec.textArray) return '';
  if (spec.arrayLen !== undefined)
    return Array.from({ length: spec.arrayLen }, () => '0').join(', ');
  return spec.type === 'char' ? '' : '0';
}

/** Build the default raw values map for a spec list. */
export function defaultRawValues(specs: readonly FieldEditorSpec[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const spec of specs) out[spec.name] = defaultRawValue(spec);
  return out;
}

/** Parse one raw editor value according to its metadata-derived field spec. */
export function parseFieldValue(spec: FieldEditorSpec, raw: string): unknown {
  if (spec.textArray || spec.type === 'char') return raw;
  if (spec.arrayLen !== undefined) return parseNumberArray(raw, spec.arrayLen);
  if (isBigIntType(spec.type)) return parseBigInt(raw);
  return parseNumber(raw);
}

/** Parse a complete message fields object from raw values. */
export function parseMessageFields(
  specs: readonly FieldEditorSpec[],
  rawValues: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const spec of specs) out[spec.name] = parseFieldValue(spec, rawValues[spec.name] ?? '');
  return out;
}

function specFromField(dialect: DialectTable, field: FieldMeta): FieldEditorSpec {
  const enumPart = field.enum === undefined ? {} : enumSpec(dialect, field.enum);
  return {
    name: field.name,
    label: field.name,
    type: field.type,
    field,
    ...(field.arrayLen !== undefined ? { arrayLen: field.arrayLen } : {}),
    ...(field.units !== undefined ? { units: field.units } : {}),
    ...(field.type === 'char' && field.arrayLen !== undefined ? { textArray: true } : {}),
    ...enumPart,
  };
}

function enumSpec(
  dialect: DialectTable,
  enumName: string,
): Pick<FieldEditorSpec, 'enumName' | 'enumOptions'> {
  const entries = dialect.enums[enumName] ?? [];
  return {
    enumName,
    enumOptions: entries.map((entry) => ({
      value: entry.value,
      name: entry.name,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
    })),
  };
}

function commandAxisSpec(
  dialect: DialectTable,
  command: EnumEntryMeta,
  axis: 'x' | 'y' | 'z',
  index: number,
): FieldEditorSpec {
  const fallback = axis.toUpperCase();
  const label = commandParamLabel(command, index, fallback);
  return {
    name: axis,
    label,
    type: axis === 'z' ? 'float' : 'int32_t',
    unused: isUnusedCommandParam(command, index),
    ...enumSpecForCommandParam(dialect, command, index, label),
  };
}

function commandParamLabel(command: EnumEntryMeta, index: number, fallback: string): string {
  const value = command.params?.[index]?.trim();
  return value === undefined || value.length === 0 ? fallback : value;
}

function isUnusedCommandParam(command: EnumEntryMeta, index: number): boolean {
  return (command.params?.[index]?.trim() ?? '').length === 0;
}

function enumSpecForCommandParam(
  dialect: DialectTable,
  command: EnumEntryMeta,
  index: number,
  label: string,
): Pick<FieldEditorSpec, 'enumName' | 'enumOptions'> {
  const enumName = inferCommandParamEnum(dialect, command, index, label);
  return enumName === undefined ? {} : enumSpec(dialect, enumName);
}

/** Infer a MAV_CMD parameter enum where the dialect exposes a matching enum. */
export function inferCommandParamEnum(
  dialect: DialectTable,
  command: EnumEntryMeta,
  index: number,
  label: string,
): string | undefined {
  const trimmed = label.trim();
  const lower = trimmed.toLowerCase();
  const commandName = command.name.toLowerCase();
  const explicit = explicitCommandParamEnum(commandName, lower, index);
  if (explicit !== undefined && dialect.enums[explicit] !== undefined) return explicit;

  const normal = toEnumName(trimmed);
  const candidates = [normal, `MAV_${normal}`];
  for (const candidate of candidates) {
    if (dialect.enums[candidate] !== undefined) return candidate;
  }
  return undefined;
}

function explicitCommandParamEnum(
  commandName: string,
  label: string,
  index: number,
): string | undefined {
  if (label.includes('frame')) return 'MAV_FRAME';
  if (label === 'speed type') return 'SPEED_TYPE';
  if (label === 'camera mode') return 'CAMERA_MODE';
  if (label === 'roi mode') return 'MAV_ROI';
  if (label === 'altitude mode') return 'MAV_FRAME';
  if (commandName.includes('mount') && label === 'mode') return 'MAV_MOUNT_MODE';
  if (commandName.endsWith('do_set_mode') && index === 0) return 'MAV_MODE';
  return undefined;
}

function toEnumName(label: string): string {
  return label
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function parseNumber(raw: string): number {
  const value = Number(raw.trim());
  return Number.isFinite(value) ? value : 0;
}

function parseBigInt(raw: string): bigint {
  try {
    const trimmed = raw.trim();
    return trimmed.length === 0 ? 0n : BigInt(trimmed);
  } catch {
    return 0n;
  }
}

function parseNumberArray(raw: string, len: number): readonly number[] {
  const parts = raw.split(',').map((part) => parseNumber(part));
  return Array.from({ length: len }, (_unused, index) => parts[index] ?? 0);
}

function isBigIntType(type: string): boolean {
  return type === 'uint64_t' || type === 'int64_t';
}

/** Format an enum option as a compact `value — name` label for dropdowns. */
export function enumOptionLabel(option: FieldEnumOption): string {
  return `${option.value} — ${option.name}`;
}
