/**
 * Live keybind bridge (spec docs/appsettings §7.5). Builds a stable
 * {@link KeybindRegistry} facade over the (reactive) registered commands + the
 * persisted `settings.keybinds` overrides, plus a `persist` that writes the
 * override diff back to the store. Used by both the global keydown dispatcher
 * (shell) and the App Settings → Keybinds section, so edits and dispatch always
 * agree. Reads commands lazily, so commands registered after boot are included.
 */
import type { AppState, CommandDef, Store } from '../../../contracts';
import { createKeybindRegistry, type KeybindRegistry } from '../../../core/keybinds';

/** Result of {@link createLiveKeybinds}. */
export interface LiveKeybinds {
  /** Stable registry facade reflecting current commands + overrides. */
  readonly registry: KeybindRegistry;
  /** Persist the current override diff into `settings.keybinds`. */
  readonly persist: () => void;
}

/**
 * Create the live keybind facade. `getCommands` returns the current command
 * list (e.g. the shell registry's reactive accessor); overrides are seeded from
 * `store.settings.keybinds` and mutated in-memory until `persist()` writes them.
 */
export function createLiveKeybinds(
  getCommands: () => readonly CommandDef[],
  store: Store<AppState>,
): LiveKeybinds {
  let overrides: Record<string, string> = { ...(store.get().settings.keybinds ?? {}) };

  const build = (): KeybindRegistry =>
    createKeybindRegistry({
      commands: getCommands().map((c) => ({
        id: c.id,
        title: c.title,
        ...(c.shortcut !== undefined ? { shortcut: c.shortcut } : {}),
      })),
      overrides,
    });

  const registry: KeybindRegistry = {
    resolve: (chord) => build().resolve(chord),
    chordFor: (id) => build().chordFor(id),
    list: () => build().list(),
    conflict: (chord, exceptId) => build().conflict(chord, exceptId),
    setOverride: (id, chord) => {
      const r = build();
      if (!r.setOverride(id, chord)) return false;
      overrides = r.serialize();
      return true;
    },
    clearOverride: (id) => {
      const next = { ...overrides };
      delete next[id];
      overrides = next;
    },
    clearAll: () => {
      overrides = {};
    },
    serialize: () => ({ ...overrides }),
  };

  const persist = (): void => {
    store.patch((d) => {
      d.settings.keybinds = { ...overrides };
    });
  };

  return { registry, persist };
}
