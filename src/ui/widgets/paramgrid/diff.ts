/**
 * Pure two-set parameter diff (task T3.4; spec plan/04 §4.5 "compare two sets —
 * vehicle vs file vs another vehicle — with diff").
 *
 * The workbench compares the *current* effective values against an injected
 * *other* set (loaded from a `.param` file or another vehicle). This module is
 * the DOM-free core of the compare/diff drawer; the drawer just renders the
 * returned rows.
 */
import type { Param } from './types';

/** A single compared parameter. `delta` is defined only when both sides exist. */
export interface DiffRow {
  /** Parameter name (upper-cased originals are preserved as given on `current`). */
  readonly name: string;
  /** Value in the current set, or `undefined` when absent there. */
  readonly current?: number;
  /** Value in the other set, or `undefined` when absent there. */
  readonly other?: number;
  /** `current - other`, present only when both sides have a value. */
  readonly delta?: number;
}

/** Either accepted shape for a parameter set fed to {@link computeDiff}. */
export type ParamSetInput = readonly Param[] | Readonly<Record<string, number>>;

/** Normalise either accepted input shape into a `name -> value` map. */
export function toValueMap(input: ParamSetInput): Map<string, number> {
  const map = new Map<string, number>();
  if (Array.isArray(input)) {
    for (const p of input as readonly Param[]) map.set(p.name, p.value);
  } else {
    for (const [name, value] of Object.entries(input as Record<string, number>)) {
      map.set(name, value);
    }
  }
  return map;
}

/**
 * Compare `current` against `other`, returning only the parameters that differ
 * (different value, or present in just one set). Rows are sorted by name. Equal
 * values are omitted so the drawer shows just the differences.
 *
 * @param current - the live/effective parameter set.
 * @param other - the comparison set (file or other vehicle).
 */
export function computeDiff(current: ParamSetInput, other: ParamSetInput): DiffRow[] {
  const a = toValueMap(current);
  const b = toValueMap(other);

  const names = new Set<string>([...a.keys(), ...b.keys()]);
  const rows: DiffRow[] = [];
  for (const name of names) {
    const cur = a.get(name);
    const oth = b.get(name);
    if (cur !== undefined && oth !== undefined) {
      if (cur === oth) continue;
      rows.push({ name, current: cur, other: oth, delta: cur - oth });
    } else if (cur !== undefined) {
      rows.push({ name, current: cur });
    } else if (oth !== undefined) {
      rows.push({ name, other: oth });
    }
  }
  rows.sort((x, y) => x.name.localeCompare(y.name));
  return rows;
}
