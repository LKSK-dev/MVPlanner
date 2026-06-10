/**
 * Live keybind bridge (spec docs/appsettings §7.5). Builds a stable
 * {@link KeybindRegistry} facade over the (reactive) registered commands + the
 * persisted `settings.keybinds` overrides, plus a `persist` that writes the
 * override diff back to the store. Used by both the global keydown dispatcher
 * (shell) and the App Settings → Keybinds section, so edits and dispatch always
 * agree. Reads commands lazily, so commands registered after boot are included.
 */
import type { AppState, CommandDef, Store } from '../../../contracts';
import {
  createKeybindRegistry,
  normalizeChord,
  type KeybindRegistry,
} from '../../../core/keybinds';

/** Result of {@link createLiveKeybinds}. */
export interface LiveKeybinds {
  /** Stable registry facade reflecting current commands + overrides. */
  readonly registry: KeybindRegistry;
  /** Persist the current override diff into `settings.keybinds`. */
  readonly persist: () => void;
}

/**
 * Create the live keybind facade. `getCommands` returns the current command
 * list (e.g. the shell registry's reactive accessor). Overrides are read LIVE
 * from `store.settings.keybinds` on every build — a settings-bundle import
 * takes effect immediately — layering only the transient unsaved edits (a
 * dirty diff) on top; `persist()` writes the merge and clears the diff.
 */
export function createLiveKeybinds(
  getCommands: () => readonly CommandDef[],
  store: Store<AppState>,
): LiveKeybinds {
  /** Unsaved edits: chord = pending override, `undefined` = pending removal. */
  const dirty = new Map<string, string | undefined>();
  /** When true, the persisted overrides are ignored (pending "reset all"). */
  let clearedAll = false;

  /** Persisted overrides + dirty diff, computed fresh on every read. */
  const effectiveOverrides = (): Record<string, string> => {
    const base: Record<string, string> = clearedAll
      ? {}
      : { ...(store.get().settings.keybinds ?? {}) };
    for (const [id, chord] of dirty) {
      if (chord === undefined) delete base[id];
      else base[id] = chord;
    }
    return base;
  };

  const build = (): KeybindRegistry =>
    createKeybindRegistry({
      commands: getCommands().map((c) => ({
        id: c.id,
        title: c.title,
        ...(c.shortcut !== undefined ? { shortcut: c.shortcut } : {}),
      })),
      overrides: effectiveOverrides(),
    });

  const registry: KeybindRegistry = {
    resolve: (chord) => build().resolve(chord),
    chordFor: (id) => build().chordFor(id),
    list: () => build().list(),
    conflict: (chord, exceptId) => build().conflict(chord, exceptId),
    setOverride: (id, chord) => {
      const norm = normalizeChord(chord);
      if (norm === undefined) return false;
      dirty.set(id, norm);
      return true;
    },
    clearOverride: (id) => {
      dirty.set(id, undefined);
    },
    clearAll: () => {
      clearedAll = true;
      dirty.clear();
    },
    serialize: () => effectiveOverrides(),
  };

  const persist = (): void => {
    const merged = effectiveOverrides();
    store.patch((d) => {
      d.settings.keybinds = merged;
      // Clear the diff only once the (coalesced) patch lands, so reads between
      // persist() and the store flush still see the merged view.
      dirty.clear();
      clearedAll = false;
    });
  };

  return { registry, persist };
}
