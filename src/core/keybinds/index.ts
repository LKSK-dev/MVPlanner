/**
 * Keybind module surface (spec docs/appsettings §5.4/§7.5): a pure chord model
 * and a registry that maps chords ↔ command ids with user overrides. The shell
 * installs the single global keydown dispatcher over a {@link KeybindRegistry}.
 */
export {
  type Chord,
  type ChordKeyEvent,
  chordFromEvent,
  formatChord,
  normalizeChord,
  parseChord,
} from './chord';
export {
  type KeybindCommand,
  type KeybindRegistry,
  type KeybindRegistryOptions,
  type KeybindRow,
  createKeybindRegistry,
} from './registry';
