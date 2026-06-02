/**
 * Custom appearance layer tests (App Settings → Appearance): CSS color
 * validation, override map building, theme-bundle serialize/parse round-trip.
 */
import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_COLOR_KEYS,
  buildColorOverrides,
  isValidCssColor,
  parseTheme,
  serializeTheme,
} from '../../src/core/theme/custom';

describe('isValidCssColor', () => {
  it('accepts safe hex/rgb/hsl/keyword colors', () => {
    for (const c of [
      '#fff',
      '#ffffff',
      '#ffffffff',
      'rgb(1,2,3)',
      'rgba(1,2,3,0.5)',
      'hsl(200,50%,50%)',
      'tomato',
    ]) {
      expect(isValidCssColor(c)).toBe(true);
    }
  });
  it('rejects injection / structure-breaking values', () => {
    for (const c of [
      'red; color: blue',
      'url(x)',
      'expression(1)',
      '}#mvp{',
      '   ',
      'a'.repeat(80),
    ]) {
      expect(isValidCssColor(c)).toBe(false);
    }
  });
});

describe('buildColorOverrides', () => {
  it('maps valid colors to canonical custom properties and skips invalid', () => {
    const out = buildColorOverrides({
      accent: '#3fb6ff',
      text: 'bad;value',
      surface: 'rgb(10,10,10)',
    });
    expect(out['--mvp-accent']).toBe('#3fb6ff');
    expect(out['--mvp-surface']).toBe('rgb(10,10,10)');
    expect(out['--mvp-text']).toBeUndefined();
  });
  it('covers every appearance color key', () => {
    expect(APPEARANCE_COLOR_KEYS.length).toBeGreaterThanOrEqual(3);
  });
});

describe('serializeTheme / parseTheme', () => {
  it('round-trips a theme bundle', () => {
    const json = serializeTheme({
      themeMode: 'system',
      density: 'compact',
      colors: { accent: '#abcdef' },
    });
    const parsed = parseTheme(json);
    expect(parsed).toEqual({
      themeMode: 'system',
      density: 'compact',
      colors: { accent: '#abcdef' },
    });
  });
  it('rejects non-bundle / drops unknown + invalid', () => {
    expect(parseTheme('{"kind":"other"}')).toBeUndefined();
    expect(parseTheme('not json')).toBeUndefined();
    const parsed = parseTheme(
      JSON.stringify({
        kind: 'mvplanner-theme',
        themeMode: 'nope',
        density: 'huge',
        colors: { accent: 'url(x)' },
        extra: 1,
      }),
    );
    expect(parsed).toEqual({});
  });
});
