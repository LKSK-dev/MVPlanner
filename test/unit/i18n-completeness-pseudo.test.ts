/**
 * Pseudo-localization audit (T8.11; spec plan/05 §5.8/§5.9, plan/10 §10.5).
 *
 * Exercises the pseudo-loc utility (`src/core/i18n/pseudo.ts`) directly and as a
 * registered locale. Pseudo-loc is the sandbox-runnable net for two classes of
 * i18n defect:
 *
 * - **hard-coded (non-`t()`) strings** — under the pseudo locale every catalog
 *   string renders with accented glyphs + `⟦…⟧` markers, so any plain-ASCII text
 *   in the rendered UI is a string that bypassed `t()`. The full DOM scan is the
 *   Playwright/axe CI gate; here we assert the transform + locale wiring so that
 *   dev mode is trustworthy.
 * - **truncation / overflow** — the ~40% length expansion surfaces clipping.
 *
 * `{var}` placeholders must survive the transform so interpolation still works.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  PSEUDO_LOCALE,
  buildPseudoCatalog,
  enablePseudoLocale,
  getMessages,
  pseudoLocalize,
  registerMessages,
  registerPseudoLocale,
  setLocale,
  t,
} from '../../src/core/i18n';

afterEach(() => {
  setLocale(DEFAULT_LOCALE);
});

describe('pseudoLocalize()', () => {
  it('wraps the unit in ⟦…⟧ boundary markers', () => {
    const out = pseudoLocalize('Save');
    expect(out.startsWith('\u27e6')).toBe(true);
    expect(out.endsWith('\u27e7')).toBe(true);
  });

  it('accents ASCII letters (no plain-ASCII letters survive in the body)', () => {
    const out = pseudoLocalize('Connect');
    const body = out.slice(1, -1);
    expect(/[A-Za-z]/.test(body.replace(/[\u2024]/g, ''))).toBe(false);
  });

  it('expands length to surface truncation risk', () => {
    const src = 'Disconnected';
    const out = pseudoLocalize(src);
    // The inner body (markers stripped) is longer than the source.
    expect(out.length - 2).toBeGreaterThan(src.length);
  });

  it('preserves {var} placeholders verbatim', () => {
    const out = pseudoLocalize('System {sysid} — {mode}');
    expect(out).toContain('{sysid}');
    expect(out).toContain('{mode}');
  });

  it('handles the empty string without crashing', () => {
    expect(pseudoLocalize('')).toBe('\u27e6\u27e7');
  });
});

describe('buildPseudoCatalog()', () => {
  it('transforms every value of a source catalog and keeps the keys', () => {
    const source = { 'x.a': 'Alpha', 'x.b': 'Beta {n}' } as const;
    const pseudo = buildPseudoCatalog(source);
    expect(Object.keys(pseudo)).toEqual(['x.a', 'x.b']);
    expect(pseudo['x.a']).toBe(pseudoLocalize('Alpha'));
    expect(pseudo['x.b']).toContain('{n}');
  });
});

describe('pseudo-locale as a registered locale', () => {
  it('registers en-XA and resolves accented strings via t()', () => {
    registerMessages({ 'pseudo.greeting': 'Hello' });
    const code = registerPseudoLocale();
    expect(code).toBe(PSEUDO_LOCALE);

    setLocale(PSEUDO_LOCALE);
    const rendered = t('pseudo.greeting');
    expect(rendered).not.toBe('Hello');
    expect(rendered).toBe(pseudoLocalize('Hello'));
  });

  it('still interpolates {var} under the pseudo locale', () => {
    registerMessages({ 'pseudo.system': 'System {sysid}' });
    enablePseudoLocale();
    const rendered = t('pseudo.system', { sysid: 7 });
    expect(rendered).toContain('7');
    expect(rendered).not.toContain('{sysid}');
  });

  it('snapshots the live English catalog (captures registered keys)', () => {
    registerMessages({ 'pseudo.snapshot': 'Snapshot probe' });
    registerPseudoLocale();
    const pseudo = getMessages(PSEUDO_LOCALE);
    expect(pseudo['pseudo.snapshot']).toBe(pseudoLocalize('Snapshot probe'));
  });
});
