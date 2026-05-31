import { afterEach, describe, expect, it } from 'vitest';
import { createEffect, createRoot } from 'solid-js';
import {
  DEFAULT_LOCALE,
  formatDate,
  formatDecimal,
  formatInteger,
  formatNumber,
  formatTime,
  getLocale,
  hasLocale,
  listLocales,
  locale,
  registerLocale,
  setLocale,
  t,
} from '../../src/core/i18n';

/** Macrotask turn so Solid's effect scheduler flushes. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// The locale signal + registry are module singletons; keep tests independent.
afterEach(() => {
  setLocale(DEFAULT_LOCALE);
});

describe('i18n t()', () => {
  it('returns the mapped string for a known key', () => {
    expect(t('app.name')).toBe('MVPlanner');
  });

  it('falls back to the key when unknown', () => {
    expect(t('does.not.exist')).toBe('does.not.exist');
  });

  it('substitutes {var} placeholders', () => {
    expect(t('screen.placeholder', { screen: 'Flight' })).toBe(
      'Flight — coming in a later milestone',
    );
  });
});

describe('i18n locale registry', () => {
  it('ships English as the default locale', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(getLocale()).toBe('en');
    expect(hasLocale('en')).toBe(true);
    expect(listLocales()).toContain('en');
  });

  it('switches the active locale via setLocale/getLocale', () => {
    expect(getLocale()).toBe('en');
    setLocale('fr');
    expect(getLocale()).toBe('fr');
  });

  it('registers a runtime locale and t() resolves its strings', () => {
    registerLocale('fr', { 'app.name': 'MVPlanner', 'nav.flight': 'Vol' });
    expect(hasLocale('fr')).toBe(true);
    expect(listLocales()).toContain('fr');

    setLocale('fr');
    expect(t('nav.flight')).toBe('Vol');
  });

  it('falls back to English for keys missing from a partial locale', () => {
    registerLocale('fr', { 'nav.flight': 'Vol' });
    setLocale('fr');
    // Present in fr.
    expect(t('nav.flight')).toBe('Vol');
    // Missing in fr → English fallback.
    expect(t('nav.plan')).toBe('Plan');
    // Missing everywhere → key fallback.
    expect(t('totally.unknown')).toBe('totally.unknown');
  });

  it('rejects an empty locale code', () => {
    expect(() => registerLocale('', {})).toThrow();
  });
});

describe('i18n reactivity', () => {
  it('re-runs a Solid effect reading locale() after setLocale()', async () => {
    registerLocale('fr', { 'nav.flight': 'Vol' });
    await createRoot(async (dispose) => {
      const seen: string[] = [];
      createEffect(() => {
        seen.push(locale());
      });
      await settle();
      expect(seen).toEqual(['en']);

      setLocale('fr');
      await settle();
      expect(seen).toEqual(['en', 'fr']);
      dispose();
    });
  });
});

describe('i18n Intl formatters', () => {
  it('formats numbers in the active (English) locale', () => {
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatInteger(1234.9)).toBe('1,235');
    expect(formatDecimal(3.1, 2)).toBe('3.10');
    expect(formatNumber(0.5, { style: 'percent' })).toBe('50%');
  });

  it('formats dates/times in the active locale', () => {
    const d = new Date('2026-05-31T13:05:00Z');
    expect(formatDate(d, { year: 'numeric', timeZone: 'UTC' })).toBe('2026');
    expect(
      formatTime(d, { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' }),
    ).toBe('13:05');
  });
});
