/**
 * Keyboard chord model for the App Settings → Keybinds section (spec
 * docs/appsettings §5.4/§7.5). Pure + DOM-light: turns key strings and keydown
 * events into a single canonical chord string and back to display text.
 *
 * A chord is `[mod+][alt+][shift+]<key>` where:
 * - `mod` is the cross-platform primary modifier — Ctrl on Windows/Linux and ⌘
 *   on macOS. Ctrl and Meta are collapsed to `mod` so one binding works on both.
 * - `key` is the lowercased `KeyboardEvent.key` (e.g. `k`, `,`, `/`, `escape`,
 *   `arrowup`). Pure-modifier presses produce no chord.
 */

/** Modifier aliases that all map to the cross-platform `mod`. */
const MOD_ALIASES = new Set(['mod', 'ctrl', 'control', 'cmd', 'command', 'meta', 'super', 'win']);
const ALT_ALIASES = new Set(['alt', 'option', 'opt']);
const SHIFT_ALIASES = new Set(['shift']);

/** Bare modifier `KeyboardEvent.key` values that never form a chord alone. */
const MODIFIER_KEYS = new Set(['control', 'meta', 'shift', 'alt', 'altgraph', 'os', 'hyper']);

/** Structured chord. */
export interface Chord {
  readonly mod: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
  /** Lowercased primary key (never a bare modifier). */
  readonly key: string;
}

/** Build the canonical string for a {@link Chord} (e.g. `mod+shift+k`). */
function chordToString(chord: Chord): string {
  const parts: string[] = [];
  if (chord.mod) parts.push('mod');
  if (chord.alt) parts.push('alt');
  if (chord.shift) parts.push('shift');
  parts.push(chord.key);
  return parts.join('+');
}

/**
 * Parse a chord string (any modifier alias, any order) into a {@link Chord}, or
 * `undefined` when there is no non-modifier key.
 */
export function parseChord(input: string): Chord | undefined {
  const tokens = input
    .trim()
    .toLowerCase()
    .split('+')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return undefined;

  let mod = false;
  let alt = false;
  let shift = false;
  let key: string | undefined;
  for (const token of tokens) {
    if (MOD_ALIASES.has(token)) mod = true;
    else if (ALT_ALIASES.has(token)) alt = true;
    else if (SHIFT_ALIASES.has(token)) shift = true;
    else key = token;
  }
  if (key === undefined || key.length === 0) return undefined;
  return { mod, alt, shift, key };
}

/**
 * Canonicalize a chord string. Returns `undefined` for an invalid/empty chord
 * (no primary key), so callers can reject bad bindings.
 */
export function normalizeChord(input: string): string | undefined {
  const chord = parseChord(input);
  return chord === undefined ? undefined : chordToString(chord);
}

/** Minimal keydown event shape consumed by {@link chordFromEvent}. */
export interface ChordKeyEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Derive the canonical chord string from a keydown event, or `undefined` when
 * the event is a bare modifier press (no primary key yet).
 */
export function chordFromEvent(event: ChordKeyEvent): string | undefined {
  const rawKey = event.key;
  if (rawKey === undefined || rawKey.length === 0) return undefined;
  const key = rawKey.toLowerCase();
  if (MODIFIER_KEYS.has(key)) return undefined;
  return chordToString({
    mod: event.ctrlKey || event.metaKey,
    alt: event.altKey,
    shift: event.shiftKey,
    key: key === ' ' ? 'space' : key,
  });
}

/** Human-readable display for a chord string (e.g. `Mod + Shift + K`). */
export function formatChord(input: string): string {
  const chord = parseChord(input);
  if (chord === undefined) return '';
  const parts: string[] = [];
  if (chord.mod) parts.push('Mod');
  if (chord.alt) parts.push('Alt');
  if (chord.shift) parts.push('Shift');
  parts.push(chord.key.length === 1 ? chord.key.toUpperCase() : capitalize(chord.key));
  return parts.join(' + ');
}

function capitalize(s: string): string {
  return s.length === 0 ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
}
