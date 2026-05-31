import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  THEME_IDS,
  applyTheme,
  clearTheme,
  getActiveTheme,
  prefersDarkScheme,
  prefersHighContrast,
  prefersReducedMotion,
  systemTheme,
} from '../../src/core/theme';

const root = document.documentElement;

/**
 * Stub `window.matchMedia` so exactly the queries in `matching` report
 * `matches:true`; every other query reports `matches:false`.
 */
function stubMatchMedia(...matching: string[]): void {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (q: string) => ({ matches: matching.includes(q), media: q }) as MediaQueryList,
  );
}

afterEach(() => {
  clearTheme();
  vi.restoreAllMocks();
});

describe('theme ids', () => {
  it('exposes exactly the four built-in themes', () => {
    expect([...THEME_IDS]).toEqual(['dark', 'light', 'high-contrast', 'field']);
  });
});

describe('applyTheme / getActiveTheme', () => {
  it('sets <html data-theme> for each built-in theme', () => {
    for (const id of THEME_IDS) {
      applyTheme(id);
      expect(root.getAttribute('data-theme')).toBe(id);
      expect(getActiveTheme()).toBe(id);
    }
  });

  it('reports undefined and removes the attribute in system/auto mode', () => {
    applyTheme('light');
    expect(getActiveTheme()).toBe('light');

    clearTheme();
    expect(root.getAttribute('data-theme')).toBeNull();
    expect(getActiveTheme()).toBeUndefined();
  });
});

describe('prefers-* readers', () => {
  it('reflect the matched media query for each OS preference', () => {
    stubMatchMedia('(prefers-reduced-motion: reduce)');
    expect(prefersReducedMotion()).toBe(true);
    expect(prefersHighContrast()).toBe(false);
    expect(prefersDarkScheme()).toBe(false);

    stubMatchMedia('(prefers-contrast: more)');
    expect(prefersHighContrast()).toBe(true);
    expect(prefersReducedMotion()).toBe(false);

    stubMatchMedia('(prefers-color-scheme: dark)');
    expect(prefersDarkScheme()).toBe(true);
    expect(prefersHighContrast()).toBe(false);
  });

  it('resolves a valid built-in theme for system/auto mode', () => {
    expect([...THEME_IDS]).toContain(systemTheme());
  });

  it('systemTheme() branches: high-contrast wins, then light, else dark', () => {
    // Increased contrast wins regardless of color scheme.
    stubMatchMedia('(prefers-contrast: more)', '(prefers-color-scheme: light)');
    expect(systemTheme()).toBe('high-contrast');

    // No high contrast + explicit light preference → light.
    stubMatchMedia('(prefers-color-scheme: light)');
    expect(systemTheme()).toBe('light');

    // Nothing matches → dark default.
    stubMatchMedia();
    expect(systemTheme()).toBe('dark');
  });
});
