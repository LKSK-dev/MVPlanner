/**
 * {@link ParamMetaStore} — a typed lookup of {@link ParamMeta} for the parameter
 * workbench (T3.4; spec plan/04 §4.5). It answers "what are the units / range /
 * increment / enum-values / bitmask / reboot flag / description of parameter X?"
 * so the workbench can render type-aware editors.
 *
 * Sources, in increasing authority (later overrides earlier, field-by-field):
 *  1. the compact {@link CURATED_PARAM_META} embedded fallback (offline default),
 *  2. optional enrichment from a bundled {@link DialectTable}'s enums/bitmasks,
 *  3. a full per-firmware `apm.pdef.json` imported at runtime via
 *     {@link ParamMetaStore.loadApmPdef} (not bundled — see README).
 *
 * Lookups are **case-insensitive** and tolerant of common ArduPilot instance
 * numbering: an exact miss falls back to the de-instanced name and to instance 1
 * (e.g. `BATT2_MONITOR` → `BATT_MONITOR`, `RC9_MIN` → `RC1_MIN`).
 */
import type { DialectTable, EnumEntryMeta, ParamMeta } from '../../contracts';

import { parseApmPdef } from './apm-pdef';
import { CURATED_PARAM_META } from './curated';

/** Reference from a parameter name to a dialect enum, for enrichment. */
export interface ParamEnumRef {
  /** Enum name as it appears in {@link DialectTable.enums}. */
  enum: string;
  /** Treat the enum as a power-of-two bitmask (fills `bitmask` not `values`). */
  bitmask?: boolean;
}

/** Field-merge `incoming` over `base`; only defined fields of `incoming` win. */
function mergeMeta(base: ParamMeta, incoming: ParamMeta): ParamMeta {
  const merged: ParamMeta = { ...base };
  if (incoming.units !== undefined) merged.units = incoming.units;
  if (incoming.min !== undefined) merged.min = incoming.min;
  if (incoming.max !== undefined) merged.max = incoming.max;
  if (incoming.increment !== undefined) merged.increment = incoming.increment;
  if (incoming.values !== undefined) merged.values = incoming.values;
  if (incoming.bitmask !== undefined) merged.bitmask = incoming.bitmask;
  if (incoming.rebootRequired !== undefined) merged.rebootRequired = incoming.rebootRequired;
  if (incoming.description !== undefined) merged.description = incoming.description;
  return merged;
}

/** Build the case-insensitive instance-fallback candidates for a name. */
function instanceCandidates(upper: string): string[] {
  // Match a digit run that immediately precedes the first underscore, e.g.
  // BATT2_MONITOR → prefix "BATT", instance "2", rest "_MONITOR".
  const m = /^([A-Z]+)(\d+)(_.+)$/.exec(upper);
  if (!m) return [];
  const prefix = m[1];
  const rest = m[3];
  if (prefix === undefined || rest === undefined) return [];
  // De-instanced first (BATT_MONITOR), then instance 1 (RC1_MIN).
  return [`${prefix}${rest}`, `${prefix}1${rest}`];
}

/** Enum entries → `value -> label` map (label prefers the human description). */
function enumToValues(entries: readonly EnumEntryMeta[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const e of entries) {
    const label = e.description && e.description.trim().length > 0 ? e.description.trim() : e.name;
    out[e.value] = label;
  }
  return out;
}

/** Power-of-two enum entries → `bitIndex -> label` map (combined flags dropped). */
function enumToBitmask(entries: readonly EnumEntryMeta[]): Record<number, string> {
  const out: Record<number, string> = {};
  for (const e of entries) {
    const v = e.value;
    if (v <= 0 || (v & (v - 1)) !== 0) continue; // not a single power-of-two bit
    const bit = Math.log2(v);
    if (!Number.isInteger(bit)) continue;
    out[bit] = e.description && e.description.trim().length > 0 ? e.description.trim() : e.name;
  }
  return out;
}

export class ParamMetaStore {
  /** Upper-cased parameter name → metadata. */
  private readonly table = new Map<string, ParamMeta>();

  /**
   * @param seed - optional initial `name -> ParamMeta` record (field-merged).
   *   Use {@link createParamMetaStore} to seed the curated fallback.
   */
  constructor(seed?: Readonly<Record<string, ParamMeta>>) {
    if (seed) this.merge(seed);
  }

  /**
   * Look up metadata for `name`. Case-insensitive; on an exact miss, falls back
   * to the de-instanced name and to instance 1. Returns the stored object (do
   * not mutate it) or `undefined` when nothing is known.
   */
  get(name: string): ParamMeta | undefined {
    const upper = name.toUpperCase();
    const direct = this.table.get(upper);
    if (direct) return direct;
    for (const cand of instanceCandidates(upper)) {
      const hit = this.table.get(cand);
      if (hit) return hit;
    }
    return undefined;
  }

  /** True when {@link get} would return metadata for `name`. */
  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  /** Number of distinct parameters with stored metadata. */
  get size(): number {
    return this.table.size;
  }

  /** Field-merge a single parameter's metadata over any existing entry. */
  set(name: string, meta: ParamMeta): void {
    const key = name.toUpperCase();
    const existing = this.table.get(key);
    this.table.set(key, existing ? mergeMeta(existing, meta) : { ...meta });
  }

  /** Field-merge a `name -> ParamMeta` record (later sources override fields). */
  merge(entries: Readonly<Record<string, ParamMeta>>): void {
    for (const [name, meta] of Object.entries(entries)) this.set(name, meta);
  }

  /**
   * Parse and merge a full ArduPilot `apm.pdef.json` document imported at
   * runtime. Imported fields override the curated fallback (and any prior
   * import) field-by-field. Returns the number of parameters merged.
   *
   * @param json - the parsed apm.pdef.json document (any shape; validated).
   */
  loadApmPdef(json: unknown): number {
    const parsed = parseApmPdef(json);
    let count = 0;
    for (const [name, meta] of Object.entries(parsed)) {
      this.set(name, meta);
      count++;
    }
    return count;
  }

  /**
   * Optionally enrich parameters with enum/bitmask labels drawn from a bundled
   * {@link DialectTable} (so editors get dropdowns even without an apm.pdef
   * import). Only fills a `values`/`bitmask` that is not already present; never
   * overrides curated/imported maps. Returns the number of parameters enriched.
   *
   * @param dialect - a bundled dialect table whose `enums` supply the labels.
   * @param map - `paramName -> { enum, bitmask? }` mapping.
   */
  enrichFromDialect(dialect: DialectTable, map: Readonly<Record<string, ParamEnumRef>>): number {
    let count = 0;
    for (const [name, ref] of Object.entries(map)) {
      const entries = dialect.enums[ref.enum];
      if (!entries) continue;
      const existing = this.get(name);
      if (ref.bitmask) {
        if (existing?.bitmask) continue;
        const bitmask = enumToBitmask(entries);
        if (Object.keys(bitmask).length === 0) continue;
        this.set(name, { bitmask });
        count++;
      } else {
        if (existing?.values) continue;
        const values = enumToValues(entries);
        if (Object.keys(values).length === 0) continue;
        this.set(name, { values });
        count++;
      }
    }
    return count;
  }
}

/**
 * Create a {@link ParamMetaStore} seeded (by default) with the curated embedded
 * fallback so editors have metadata offline. Pass `{ curated: false }` for an
 * empty store (e.g. to test a pure apm.pdef import).
 */
export function createParamMetaStore(opts?: { curated?: boolean }): ParamMetaStore {
  const store = new ParamMetaStore();
  if (opts?.curated !== false) store.merge(CURATED_PARAM_META);
  return store;
}
