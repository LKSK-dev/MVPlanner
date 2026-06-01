/**
 * Pure, DOM-free helpers for the parameter grid (task T3.4; spec plan/04 §4.5).
 *
 * Everything that decides *what* the grid shows — editor selection, grouping,
 * search/filtering, modified / out-of-range detection, sorting, per-type value
 * parsing and bitmask arithmetic — lives here so it is unit-tested without
 * mounting a component. The component (`paramgrid.tsx`) is a thin render of
 * these results.
 */
import { MAV_PARAM_TYPE } from '../../../mavlink/microservices/param';
import type {
  EditorKind,
  Param,
  ParamGroup,
  ParamMeta,
  ParamMetaResolver,
  ParamRow,
  SortDir,
  SortKey,
} from './types';

/** True when the wire `MAV_PARAM_TYPE` is an integer type (not REAL32/REAL64). */
export function isIntegerParamType(type: number): boolean {
  return type !== MAV_PARAM_TYPE.REAL32 && type !== MAV_PARAM_TYPE.REAL64;
}

/**
 * Choose the editor for a parameter from its metadata + wire type. Bitmask and
 * enum metadata win (they imply discrete editors); otherwise an integer wire
 * type (or an integer `increment`) yields a spinner, and everything else a
 * float input.
 */
export function editorKindFor(meta: ParamMeta | undefined, type: number): EditorKind {
  if (meta?.bitmask && Object.keys(meta.bitmask).length > 0) return 'bitmask';
  if (meta?.values && Object.keys(meta.values).length > 0) return 'enum';
  if (meta?.increment !== undefined && !Number.isInteger(meta.increment)) return 'float';
  return isIntegerParamType(type) ? 'int' : 'float';
}

/** The grouping key for a name: the prefix up to the first `_` (else the name). */
export function groupPrefix(name: string): string {
  const i = name.indexOf('_');
  return i > 0 ? name.slice(0, i) : name;
}

/** The value the grid shows/edits for `name`: a staged edit, else the base. */
export function effectiveValue(
  base: number,
  pending: ReadonlyMap<string, number>,
  name: string,
): number {
  const staged = pending.get(name);
  return staged ?? base;
}

/** True when a staged value exists for `name` and differs from `base`. */
export function isModified(
  base: number,
  pending: ReadonlyMap<string, number>,
  name: string,
): boolean {
  const staged = pending.get(name);
  return staged !== undefined && staged !== base;
}

/** True when `value` falls outside a known `meta.min`/`meta.max` bound. */
export function isOutOfRange(value: number, meta: ParamMeta | undefined): boolean {
  if (!meta) return false;
  if (meta.min !== undefined && value < meta.min) return true;
  if (meta.max !== undefined && value > meta.max) return true;
  return false;
}

/**
 * Build the enriched {@link ParamRow} list from base params + the staged-edit
 * map, resolving metadata through `resolver` (falling back to `param.meta`).
 */
export function buildRows(
  params: readonly Param[],
  pending: ReadonlyMap<string, number>,
  resolver: ParamMetaResolver,
): ParamRow[] {
  const out: ParamRow[] = [];
  for (const param of params) {
    const meta = resolver.get(param.name) ?? param.meta;
    const staged = pending.get(param.name);
    const pendingVal = staged !== undefined && staged !== param.value ? staged : undefined;
    const effective = staged ?? param.value;
    out.push({
      param,
      meta,
      editor: editorKindFor(meta, param.type),
      pending: pendingVal,
      effective,
      modified: pendingVal !== undefined,
      outOfRange: isOutOfRange(effective, meta),
    });
  }
  return out;
}

/**
 * Filter rows by a free-text query matched (case-insensitively) against the
 * parameter name and its description. An empty/blank query keeps every row.
 */
export function filterRows(rows: readonly ParamRow[], query: string): ParamRow[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...rows];
  return rows.filter((r) => {
    if (r.param.name.toLowerCase().includes(q)) return true;
    const desc = r.meta?.description;
    return desc !== undefined && desc.toLowerCase().includes(q);
  });
}

/** Sort rows by name or value, ascending or descending (stable on ties). */
export function sortRows(rows: readonly ParamRow[], key: SortKey, dir: SortDir): ParamRow[] {
  const factor = dir === 'asc' ? 1 : -1;
  const copy = [...rows];
  copy.sort((a, b) => {
    const cmp =
      key === 'value'
        ? a.effective - b.effective || a.param.name.localeCompare(b.param.name)
        : a.param.name.localeCompare(b.param.name);
    return cmp * factor;
  });
  return copy;
}

/**
 * Group rows by name prefix (up to the first `_`) for the tree view. Groups are
 * sorted by prefix; rows inside each group keep the incoming order (sort them
 * first with {@link sortRows} for a fully ordered tree).
 */
export function groupRows(rows: readonly ParamRow[]): ParamGroup[] {
  const byPrefix = new Map<string, ParamRow[]>();
  for (const row of rows) {
    const key = groupPrefix(row.param.name);
    const bucket = byPrefix.get(key);
    if (bucket) bucket.push(row);
    else byPrefix.set(key, [row]);
  }
  const groups: ParamGroup[] = [];
  for (const [prefix, members] of byPrefix) {
    let modifiedCount = 0;
    let outOfRangeCount = 0;
    for (const r of members) {
      if (r.modified) modifiedCount++;
      if (r.outOfRange) outOfRangeCount++;
    }
    groups.push({ prefix, rows: members, modifiedCount, outOfRangeCount });
  }
  groups.sort((a, b) => a.prefix.localeCompare(b.prefix));
  return groups;
}

/**
 * Parse a raw editor input string into a numeric value for `kind`, or
 * `undefined` when it is blank / not finite. Integer-ish editors (int, enum,
 * bitmask) round to the nearest integer; floats keep full precision.
 */
export function parseEditorValue(kind: EditorKind, raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return undefined;
  return kind === 'float' ? n : Math.round(n);
}

/** True when bit index `bit` (0-based) is set in `value` (32-bit-safe). */
export function hasBit(value: number, bit: number): boolean {
  return Math.floor(value / 2 ** bit) % 2 === 1;
}

/**
 * Return `value` with bit index `bit` set to `on`. Uses arithmetic (not 32-bit
 * bitwise ops) so masks with bit 31+ stay correct.
 */
export function toggleBit(value: number, bit: number, on: boolean): number {
  const already = hasBit(value, bit);
  if (on === already) return value;
  return on ? value + 2 ** bit : value - 2 ** bit;
}

/** Sorted `[bit, label]` pairs for a bitmask meta map (numeric bit order). */
export function bitmaskEntries(meta: ParamMeta): Array<[number, string]> {
  if (!meta.bitmask) return [];
  return Object.entries(meta.bitmask)
    .map(([k, label]): [number, string] => [Number(k), label])
    .filter(([bit]) => Number.isFinite(bit))
    .sort((a, b) => a[0] - b[0]);
}

/** Sorted `[value, label]` pairs for an enum meta map (numeric value order). */
export function enumEntries(meta: ParamMeta): Array<[number, string]> {
  if (!meta.values) return [];
  return Object.entries(meta.values)
    .map(([k, label]): [number, string] => [Number(k), label])
    .filter(([value]) => Number.isFinite(value))
    .sort((a, b) => a[0] - b[0]);
}
