/**
 * i18n completeness + key-enumeration audit (T8.11; spec plan/05 §5.9, plan/10
 * §10.5, validation plan/implementation/05 §5.1 V5).
 *
 * Loads the app's REGISTERED English catalog — i.e. every key contributed via
 * `registerMessages` at import time — by eagerly importing all per-module
 * `messages.ts` registration modules plus the three sibling `register.ts`
 * modules that register the `gauges.*` / `statustext.*` / `actions.*`+`audit.*`
 * namespaces. It then asserts:
 *
 * - the namespaces actually in use are all present and non-empty;
 * - `t()` resolves every registered key to its template (never the bare key);
 * - `t()` falls back to the key (does not throw) for an unknown key;
 * - `{var}` interpolation works.
 *
 * Full per-screen axe scans remain the Playwright/axe CI gate (browser-deferred,
 * plan/implementation/05 §5.6 nightly); this is the sandbox-runnable slice.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, getMessages, messageKeys, setLocale, t } from '../../src/core/i18n';

// Eagerly import every per-module message-registration module for its
// side-effect (each calls `registerMessages` at import). These modules only
// import `core/i18n` (+ local type/model files), so importing them is cheap and
// does not pull a full component tree.
const messageModules = import.meta.glob('../../src/**/messages.ts', { eager: true });

// Three namespaces register from a sibling `register.ts` (no `messages.ts`).
import '../../src/ui/widgets/gauges/register';
import '../../src/ui/widgets/messages/register';
import '../../src/ui/screens/flight/actions/register';

/** Namespaces that MUST be registered for the shell + the six screens to work. */
const REQUIRED_NAMESPACES: readonly string[] = [
  // shell + nav + connection (central EN_MESSAGES).
  'app',
  'nav',
  'shell',
  'conn',
  'status',
  'a11y',
  'palette',
  'cmd',
  'confirm',
  // inspector (central).
  'inspector',
  // widgets (registered at import).
  'hud',
  'gauges',
  'statustext',
  'map',
  'quickwatch',
  'plotter',
  'msgsender',
  'console',
  // screens.
  'flight',
  'actions',
  'audit',
  'plan',
  'mission',
  'cmd',
  'fence',
  'rally',
  'survey',
  'terrain',
  'setup',
  'config',
  'settings',
  'tuning',
  'params',
  'logs',
  'sim',
];

describe('i18n completeness (registered English catalog)', () => {
  beforeAll(() => {
    setLocale(DEFAULT_LOCALE);
    // Touch the glob so bundlers/linters keep the eager import side-effects.
    expect(Object.keys(messageModules).length).toBeGreaterThan(20);
  });

  it('enumerates a substantial registered key set', () => {
    const keys = messageKeys(DEFAULT_LOCALE);
    expect(keys.length).toBeGreaterThan(200);
    // messageKeys() defaults to the English source-of-truth catalog.
    expect(messageKeys()).toEqual(keys);
  });

  it('registers every namespace the shell + six screens use', () => {
    const keys = messageKeys(DEFAULT_LOCALE);
    const namespaces = new Set(keys.map((k) => k.split('.')[0]));
    const missing = REQUIRED_NAMESPACES.filter((ns) => !namespaces.has(ns));
    expect(missing, `missing namespaces: ${missing.join(', ')}`).toEqual([]);
  });

  it('has a non-empty string value for every registered key', () => {
    const catalog = getMessages(DEFAULT_LOCALE);
    const empties = Object.entries(catalog)
      .filter(([, value]) => typeof value !== 'string' || value.length === 0)
      .map(([key]) => key);
    expect(empties, `empty values: ${empties.join(', ')}`).toEqual([]);
  });

  it('resolves every registered key through t() (never the bare key)', () => {
    const catalog = getMessages(DEFAULT_LOCALE);
    const unresolved: string[] = [];
    for (const key of Object.keys(catalog)) {
      // t() with no vars returns the template verbatim (placeholders intact),
      // which must equal the registered value and differ from the key.
      if (t(key) !== catalog[key]) unresolved.push(key);
    }
    expect(unresolved, `unresolved keys: ${unresolved.join(', ')}`).toEqual([]);
  });

  it('falls back to the key (no crash) for an unknown key', () => {
    expect(() => t('totally.unregistered.key')).not.toThrow();
    expect(t('totally.unregistered.key')).toBe('totally.unregistered.key');
  });

  it('interpolates {var} placeholders for a parameterised key', () => {
    // `screen.placeholder` ships as "{screen} — coming in a later milestone".
    expect(t('screen.placeholder', { screen: 'Flight' })).toContain('Flight');
    expect(t('screen.placeholder', { screen: 'Flight' })).not.toContain('{screen}');
  });
});
