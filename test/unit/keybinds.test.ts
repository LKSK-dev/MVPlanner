/**
 * Keybind chord model + registry tests (App Settings → Keybinds).
 */
import { describe, expect, it } from 'vitest';
import { chordFromEvent, formatChord, normalizeChord, parseChord } from '../../src/core/keybinds';
import { createKeybindRegistry } from '../../src/core/keybinds';

describe('chord parsing/normalizing', () => {
  it('normalizes modifier aliases + order', () => {
    expect(normalizeChord('Cmd+K')).toBe('mod+k');
    expect(normalizeChord('Control+Shift+P')).toBe('mod+shift+p');
    expect(normalizeChord('shift+alt+mod+/')).toBe('mod+alt+shift+/');
    expect(normalizeChord('meta+,')).toBe('mod+,');
  });
  it('rejects modifier-only chords', () => {
    expect(parseChord('mod')).toBeUndefined();
    expect(normalizeChord('shift+')).toBeUndefined();
  });
  it('derives a chord from a keydown event (ctrl/meta collapse to mod)', () => {
    expect(
      chordFromEvent({ key: 'k', ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }),
    ).toBe('mod+k');
    expect(
      chordFromEvent({ key: 'K', ctrlKey: false, metaKey: true, altKey: false, shiftKey: true }),
    ).toBe('mod+shift+k');
    expect(
      chordFromEvent({
        key: 'Control',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
    ).toBeUndefined();
  });
  it('formats a chord for display', () => {
    expect(formatChord('mod+shift+k')).toBe('Mod + Shift + K');
    expect(formatChord('escape')).toBe('Escape');
  });
});

describe('keybind registry', () => {
  const commands = [
    { id: 'app.settings.open', title: 'Open settings', shortcut: 'mod+,' },
    { id: 'cmd.palette', title: 'Command palette', shortcut: 'mod+k' },
    { id: 'nav.flight', title: 'Go to Flight' },
  ];

  it('resolves defaults and reports rows', () => {
    const reg = createKeybindRegistry({ commands });
    expect(reg.resolve('mod+,')).toBe('app.settings.open');
    expect(reg.chordFor('cmd.palette')).toBe('mod+k');
    expect(reg.list().find((r) => r.commandId === 'nav.flight')?.chord).toBeUndefined();
  });

  it('applies overrides, detects conflicts, and serializes the diff', () => {
    const reg = createKeybindRegistry({ commands, overrides: { 'nav.flight': 'mod+1' } });
    expect(reg.resolve('mod+1')).toBe('nav.flight');
    expect(reg.conflict('mod+k')).toBe('cmd.palette');
    expect(reg.conflict('mod+1', 'nav.flight')).toBeUndefined();
    expect(reg.setOverride('nav.flight', 'mod+2')).toBe(true);
    expect(reg.setOverride('nav.flight', 'shift+')).toBe(false);
    expect(reg.resolve('mod+2')).toBe('nav.flight');
    expect(reg.serialize()).toEqual({ 'nav.flight': 'mod+2' });
    reg.clearOverride('nav.flight');
    expect(reg.serialize()).toEqual({});
  });
});
