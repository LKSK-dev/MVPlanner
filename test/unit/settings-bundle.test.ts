/**
 * Settings bundle tests (App Settings → General): serialize redacts secrets;
 * parse validates + sanitizes; round-trip preserves non-secret fields.
 */
import { describe, expect, it } from 'vitest';
import { parseSettingsBundle, serializeSettings } from '../../src/core/settings-bundle';
import type { AppSettings } from '../../src/contracts';

const SETTINGS: AppSettings = {
  units: 'imperial',
  coordinateFormat: 'dms',
  theme: 'light',
  language: 'en',
  audioAlerts: true,
  confirmDestructive: false,
  telemetryRateHz: 8,
  mapSource: { urlTemplate: 'https://t/{z}/{x}/{y}.png', apiKey: 'secret-key' },
  appearance: { themeMode: 'system', density: 'compact', colors: { accent: '#abcdef' } },
  keybinds: { 'nav.flight': 'mod+1' },
};

describe('settings bundle', () => {
  it('redacts the map API key on export', () => {
    const json = serializeSettings(SETTINGS);
    expect(json).not.toContain('secret-key');
    const parsed = JSON.parse(json) as { settings: AppSettings };
    expect(parsed.settings.mapSource?.urlTemplate).toBe('https://t/{z}/{x}/{y}.png');
    expect(parsed.settings.mapSource?.apiKey).toBeUndefined();
  });

  it('round-trips non-secret settings', () => {
    const patch = parseSettingsBundle(serializeSettings(SETTINGS));
    expect(patch?.units).toBe('imperial');
    expect(patch?.coordinateFormat).toBe('dms');
    expect(patch?.telemetryRateHz).toBe(8);
    expect(patch?.appearance?.density).toBe('compact');
    expect(patch?.keybinds).toEqual({ 'nav.flight': 'mod+1' });
  });

  it('rejects non-bundles and drops invalid fields', () => {
    expect(parseSettingsBundle('nope')).toBeUndefined();
    expect(parseSettingsBundle('{"kind":"other"}')).toBeUndefined();
    const patch = parseSettingsBundle(
      JSON.stringify({
        kind: 'mvplanner-settings',
        version: 1,
        settings: { units: 'parsecs', theme: 'neon', telemetryRateHz: -1 },
      }),
    );
    expect(patch).toEqual({});
  });
});
