/**
 * Public types for parameter file I/O + presets (task T3.5; spec plan/04 §4.5,
 * plan/07 §7.6).
 *
 * These shapes are deliberately MINIMAL and decoupled from the live MAVLink
 * {@link import('../../contracts').Param} (which additionally carries a
 * `type`/`meta`): a `.param`/`.parm` file and a preset only ever describe a
 * `name → numeric value` mapping. A `Param[]` is structurally assignable to
 * `ParamFileEntry[]`, so callers can serialize live params directly.
 */
import type { KvStore } from '../../contracts';

/** One parsed/serialized parameter line: a name and its numeric value. */
export interface ParamFileEntry {
  /** Parameter name exactly as it appears in the file (e.g. `ATC_RAT_RLL_P`). */
  readonly name: string;
  /** Numeric value (ints and floats both represented as `number`). */
  readonly value: number;
}

/**
 * A named, **partial** set of parameters persisted as JSON (spec plan/07 §7.6).
 * Unlike a full `.param` dump, a preset intentionally carries only the subset of
 * params it wants to apply (e.g. a tuning profile), so {@link applyPreset}
 * produces a focused diff.
 */
export interface Preset {
  /** Unique preset name (also the persistence key). */
  readonly name: string;
  /** Optional human description. */
  readonly description?: string;
  /** The partial `name → value` map this preset would apply. */
  readonly params: Readonly<Record<string, number>>;
}

/** How a single preset entry relates to the current parameter set. */
export type PresetChangeKind = 'added' | 'changed' | 'unchanged';

/**
 * One line of a preset-application diff. `from` is omitted when the parameter is
 * absent from the current set (`kind === 'added'`).
 */
export interface PresetDiffChange {
  /** Parameter name. */
  readonly name: string;
  /** Current value, omitted when the parameter is not present in `current`. */
  readonly from?: number;
  /** Value the preset would write. */
  readonly to: number;
  /** Whether applying this entry adds, changes, or leaves the value untouched. */
  readonly kind: PresetChangeKind;
}

/**
 * The result of {@link applyPreset}: every preset entry annotated with what it
 * would do, so the UI can preview before any write. Entries are sorted by name.
 */
export interface PresetDiff {
  readonly changes: readonly PresetDiffChange[];
}

/**
 * Persistent CRUD over named presets, backed by a {@link KvStore} namespace
 * (spec plan/07 §7.2 "Parameter files & presets → IndexedDB"). Created via
 * {@link import('./presets').createPresetStore}.
 */
export interface PresetStore {
  /** All stored presets (in index order). */
  list(): Promise<Preset[]>;
  /** Fetch one preset by name, or `undefined` if absent. */
  get(name: string): Promise<Preset | undefined>;
  /** Insert or replace a preset (and update the name index). */
  save(preset: Preset): Promise<void>;
  /** Remove a preset by name (no-op if absent). */
  remove(name: string): Promise<void>;
}

/** A current-parameter snapshot accepted by {@link applyPreset}. */
export type CurrentParams = readonly ParamFileEntry[] | Readonly<Record<string, number>>;

/** Re-exported for convenience (preset stores need a {@link KvStore}). */
export type { KvStore };

/** A loaded parameter file: its source name plus parsed entries. */
export interface LoadedParamFile {
  /** File name reported by the picker (e.g. `copter.param`). */
  readonly name: string;
  /** Parsed entries in file order. */
  readonly params: readonly ParamFileEntry[];
}
