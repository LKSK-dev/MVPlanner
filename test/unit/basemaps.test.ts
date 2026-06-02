/**
 * Basemap preset + resolver tests (App Settings → Maps): settings → BasemapSource.
 */
import { describe, expect, it } from 'vitest';
import {
  BASEMAP_PRESETS,
  basemapFromSettings,
  presetIdForSettings,
} from '../../src/ui/widgets/map';

describe('basemapFromSettings', () => {
  it('defaults to the built-in CARTO dark when unconfigured', () => {
    expect(basemapFromSettings(undefined).id).toBe('carto-dark');
    expect(presetIdForSettings(undefined)).toBe('carto-dark');
  });

  it('recognizes a known preset URL', () => {
    const osm = BASEMAP_PRESETS.find((p) => p.id === 'osm');
    const src = basemapFromSettings({ urlTemplate: osm?.url ?? '' });
    expect(src.id).toBe('osm');
    expect(presetIdForSettings({ urlTemplate: osm?.url ?? '' })).toBe('osm');
  });

  it('treats an unknown URL as custom and carries the api key', () => {
    const src = basemapFromSettings({
      urlTemplate: 'https://t/{z}/{x}/{y}.png?k={apiKey}',
      apiKey: 'secret',
    });
    expect(src.id).toBe('custom');
    expect(src.kind).toBe('xyz');
    expect(src.apiKey).toBe('secret');
    expect(presetIdForSettings({ urlTemplate: 'https://t/{z}/{x}/{y}.png' })).toBe('custom');
  });

  it('detects a WMS template', () => {
    expect(basemapFromSettings({ urlTemplate: 'https://w?BBOX={bbox-epsg-3857}' }).kind).toBe(
      'wms',
    );
  });
});
