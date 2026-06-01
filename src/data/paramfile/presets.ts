/**
 * Parameter presets — named partial sets with apply/diff (task T3.5; spec
 * plan/04 §4.5, plan/07 §7.6).
 *
 * Presets are persisted as JSON in a {@link KvStore} namespace. Because
 * `KvStore` has no enumeration primitive, the store maintains its own name index
 * under a reserved key so {@link PresetStore.list} can resolve every preset.
 *
 * {@link applyPreset} never writes: it produces a {@link PresetDiff} preview
 * (added / changed / unchanged) so the UI can confirm before any vehicle write;
 * {@link diffToWrites} then reduces that diff to the concrete set of writes.
 */
import type {
  CurrentParams,
  KvStore,
  ParamFileEntry,
  Preset,
  PresetDiff,
  PresetDiffChange,
  PresetStore,
} from './types';

/** Default {@link KvStore} namespace for presets. */
export const PRESET_NS = 'param-presets';

/**
 * Reserved index key (holds the array of preset names). It is not a legal preset
 * name, so a stored preset can never collide with it.
 */
export const PRESET_INDEX_KEY = '\u0000index';

/** Normalize a {@link CurrentParams} snapshot into a `name → value` lookup. */
function toLookup(current: CurrentParams): Map<string, number> {
  const map = new Map<string, number>();
  if (Array.isArray(current)) {
    for (const entry of current as readonly ParamFileEntry[]) {
      map.set(entry.name, entry.value);
    }
  } else {
    for (const [name, value] of Object.entries(current as Record<string, number>)) {
      map.set(name, value);
    }
  }
  return map;
}

/**
 * Compute what applying `preset` would do against the `current` parameters.
 *
 * @param preset - The preset whose `params` would be applied.
 * @param current - Current parameters (a `Param[]`/`ParamFileEntry[]` or a
 *   `name → value` record).
 * @returns A {@link PresetDiff} with one entry per preset parameter, annotated
 *   `added` / `changed` / `unchanged`, sorted by name.
 */
export function applyPreset(preset: Preset, current: CurrentParams): PresetDiff {
  const lookup = toLookup(current);
  const changes: PresetDiffChange[] = [];
  for (const name of Object.keys(preset.params).sort()) {
    const to = preset.params[name];
    if (to === undefined) {
      continue;
    }
    if (!lookup.has(name)) {
      changes.push({ name, to, kind: 'added' });
      continue;
    }
    const from = lookup.get(name) as number;
    changes.push({ name, from, to, kind: from === to ? 'unchanged' : 'changed' });
  }
  return { changes };
}

/**
 * Reduce a {@link PresetDiff} to the writes it implies: every `added` or
 * `changed` entry (i.e. anything that would actually alter the vehicle),
 * dropping `unchanged` entries.
 *
 * @param diff - A diff produced by {@link applyPreset}.
 * @returns The `name → value` writes to apply.
 */
export function diffToWrites(diff: PresetDiff): ParamFileEntry[] {
  const writes: ParamFileEntry[] = [];
  for (const c of diff.changes) {
    if (c.kind !== 'unchanged') {
      writes.push({ name: c.name, value: c.to });
    }
  }
  return writes;
}

/** Validate a preset name (non-empty, not the reserved index key). */
function assertValidName(name: string): void {
  if (name === '') {
    throw new Error('Preset name must be non-empty');
  }
  if (name === PRESET_INDEX_KEY) {
    throw new Error('Preset name is reserved');
  }
}

/**
 * Create a {@link PresetStore} over a {@link KvStore} namespace.
 *
 * @param kv - The key/value store (from `data/storage`).
 * @param ns - Namespace to isolate presets in (default {@link PRESET_NS}).
 * @returns A persistent list/get/save/remove store.
 */
export function createPresetStore(kv: KvStore, ns: string = PRESET_NS): PresetStore {
  async function readIndex(): Promise<string[]> {
    const idx = await kv.get<string[]>(ns, PRESET_INDEX_KEY);
    return Array.isArray(idx) ? idx : [];
  }

  async function writeIndex(names: string[]): Promise<void> {
    await kv.set<string[]>(ns, PRESET_INDEX_KEY, names);
  }

  return {
    async list(): Promise<Preset[]> {
      const names = await readIndex();
      const presets: Preset[] = [];
      for (const name of names) {
        const preset = await kv.get<Preset>(ns, name);
        if (preset) {
          presets.push(preset);
        }
      }
      return presets;
    },

    async get(name: string): Promise<Preset | undefined> {
      if (name === PRESET_INDEX_KEY) {
        return undefined;
      }
      return kv.get<Preset>(ns, name);
    },

    async save(preset: Preset): Promise<void> {
      assertValidName(preset.name);
      await kv.set<Preset>(ns, preset.name, preset);
      const names = await readIndex();
      if (!names.includes(preset.name)) {
        names.push(preset.name);
        await writeIndex(names);
      }
    },

    async remove(name: string): Promise<void> {
      if (name === PRESET_INDEX_KEY) {
        return;
      }
      await kv.del(ns, name);
      const names = await readIndex();
      const next = names.filter((n) => n !== name);
      if (next.length !== names.length) {
        await writeIndex(next);
      }
    },
  };
}
