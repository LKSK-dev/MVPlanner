import { afterEach, describe, expect, it } from 'vitest';
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

afterEach(() => {
  clearTheme();
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
  it('return booleans for the OS accessibility preferences', () => {
    expect(typeof prefersReducedMotion()).toBe('boolean');
    expect(typeof prefersHighContrast()).toBe('boolean');
    expect(typeof prefersDarkScheme()).toBe('boolean');
  });

  it('resolves a valid built-in theme for system/auto mode', () => {
    expect([...THEME_IDS]).toContain(systemTheme());
  });
});
