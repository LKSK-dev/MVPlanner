/**
 * Theme library + outline color tests (App Settings → Appearance 0.3).
 */
import { describe, expect, it } from 'vitest';
import {
  APPEARANCE_COLOR_KEYS,
  buildColorOverrides,
  effectiveAppearance,
  installTheme,
  uninstallTheme,
} from '../../src/core/theme';
import type { AppearanceSettings } from '../../src/contracts';

describe('outline color', () => {
  it('includes outline and maps it to --mvp-border', () => {
    expect(APPEARANCE_COLOR_KEYS).toContain('outline');
    const out = buildColorOverrides({ outline: '#334155' });
    expect(out['--mvp-border']).toBe('#334155');
  });
});

describe('theme library', () => {
  const appearance: AppearanceSettings = {
    themeMode: 'dark',
    colors: { accent: '#abcdef' },
    density: 'compact',
  };

  it('installs a theme into the library and gives it an id', () => {
    const { library, id } = installTheme(undefined, appearance, 'My Theme');
    expect(library).toHaveLength(1);
    expect(library[0]?.name).toBe('My Theme');
    expect(library[0]?.id).toBe(id);
    expect(library[0]?.bundle.colors?.accent).toBe('#abcdef');
  });

  it('uninstalls by id', () => {
    const { library, id } = installTheme(undefined, appearance, 'X');
    expect(uninstallTheme(library, id)).toHaveLength(0);
  });

  it('effectiveAppearance applies the active installed theme bundle', () => {
    const { library, id } = installTheme(undefined, appearance, 'X');
    const eff = effectiveAppearance({
      themeMode: 'light',
      activeThemeId: id,
      themeLibrary: library,
    });
    expect(eff?.themeMode).toBe('dark'); // from the installed bundle, not the inline 'light'
    expect(eff?.colors?.accent).toBe('#abcdef');
  });

  it('falls back to inline appearance when no active theme', () => {
    const eff = effectiveAppearance({ themeMode: 'field' });
    expect(eff?.themeMode).toBe('field');
  });
});
