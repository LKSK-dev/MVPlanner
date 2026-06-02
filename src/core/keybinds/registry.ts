/**
 * Keybind registry (spec docs/appsettings §7.5): merges a default chord table
 * (seeded from registered commands' `shortcut`) with user overrides, resolves a
 * pressed chord to a command id, detects conflicts, and serializes the override
 * diff for persistence into `settings.keybinds`.
 *
 * Pure data structure — the shell owns the single global `keydown` listener and
 * the actual command dispatch; this module only maps chords ↔ command ids.
 */
import { normalizeChord } from './chord';

/** One resolved binding row for the Keybinds UI. */
export interface KeybindRow {
  readonly commandId: string;
  /** Human title for the command (falls back to the id). */
  readonly title: string;
  /** Effective canonical chord, or undefined when unbound. */
  readonly chord: string | undefined;
  /** True when the effective chord differs from the built-in default. */
  readonly isOverride: boolean;
  /** The built-in default chord, if any. */
  readonly defaultChord: string | undefined;
}

/** A command known to the registry (id + title + default chord). */
export interface KeybindCommand {
  readonly id: string;
  readonly title: string;
  /** Default chord (raw; normalized internally). */
  readonly shortcut?: string;
}

/** Inputs to {@link createKeybindRegistry}. */
export interface KeybindRegistryOptions {
  readonly commands: readonly KeybindCommand[];
  /** Persisted user overrides: command id → chord (raw; normalized internally). */
  readonly overrides?: Record<string, string>;
}

/** Live keybind registry. */
export interface KeybindRegistry {
  /** Resolve a pressed canonical chord to a command id (override wins). */
  resolve(chord: string): string | undefined;
  /** The effective chord for a command id. */
  chordFor(commandId: string): string | undefined;
  /** All known commands as display rows, sorted by title. */
  list(): KeybindRow[];
  /** The command id already bound to `chord` (other than `exceptId`), if any. */
  conflict(chord: string, exceptId?: string): string | undefined;
  /** Set/replace a user override (no-op + returns false for an invalid chord). */
  setOverride(commandId: string, chord: string): boolean;
  /** Remove a user override, restoring the command's default. */
  clearOverride(commandId: string): void;
  /** Remove all user overrides. */
  clearAll(): void;
  /** The override diff for persistence (only commands that differ from default). */
  serialize(): Record<string, string>;
}

/**
 * Create a {@link KeybindRegistry}. Defaults come from each command's
 * normalized `shortcut`; `overrides` (e.g. `settings.keybinds`) take precedence.
 */
export function createKeybindRegistry(options: KeybindRegistryOptions): KeybindRegistry {
  const titles = new Map<string, string>();
  const defaults = new Map<string, string>();
  const order: string[] = [];
  for (const cmd of options.commands) {
    if (!titles.has(cmd.id)) order.push(cmd.id);
    titles.set(cmd.id, cmd.title);
    const def = cmd.shortcut !== undefined ? normalizeChord(cmd.shortcut) : undefined;
    if (def !== undefined) defaults.set(cmd.id, def);
  }

  const overrides = new Map<string, string>();
  for (const [id, chord] of Object.entries(options.overrides ?? {})) {
    const norm = normalizeChord(chord);
    if (norm !== undefined) overrides.set(id, norm);
  }

  const chordFor = (commandId: string): string | undefined =>
    overrides.get(commandId) ?? defaults.get(commandId);

  const resolve = (chord: string): string | undefined => {
    const norm = normalizeChord(chord);
    if (norm === undefined) return undefined;
    // Overrides take precedence; then defaults that are not shadowed/remapped.
    for (const [id, c] of overrides) if (c === norm) return id;
    for (const id of order) {
      if (overrides.has(id)) continue; // remapped away
      if (defaults.get(id) === norm && !isChordTaken(norm, id)) return id;
    }
    return undefined;
  };

  // True when an override has claimed `chord` for a different command.
  const isChordTaken = (chord: string, exceptId: string): boolean => {
    for (const [id, c] of overrides) if (c === chord && id !== exceptId) return true;
    return false;
  };

  const conflict = (chord: string, exceptId?: string): string | undefined => {
    const norm = normalizeChord(chord);
    if (norm === undefined) return undefined;
    for (const id of order) {
      if (id === exceptId) continue;
      if (chordFor(id) === norm) return id;
    }
    return undefined;
  };

  return {
    resolve,
    chordFor,
    conflict,
    list(): KeybindRow[] {
      return order
        .map((id): KeybindRow => {
          const effective = chordFor(id);
          const def = defaults.get(id);
          return {
            commandId: id,
            title: titles.get(id) ?? id,
            chord: effective,
            isOverride: effective !== def,
            defaultChord: def,
          };
        })
        .sort((a, b) => a.title.localeCompare(b.title));
    },
    setOverride(commandId: string, chord: string): boolean {
      const norm = normalizeChord(chord);
      if (norm === undefined) return false;
      overrides.set(commandId, norm);
      return true;
    },
    clearOverride(commandId: string): void {
      overrides.delete(commandId);
    },
    clearAll(): void {
      overrides.clear();
    },
    serialize(): Record<string, string> {
      const out: Record<string, string> = {};
      for (const [id, chord] of overrides) {
        if (defaults.get(id) !== chord) out[id] = chord;
      }
      return out;
    },
  };
}
