/**
 * Basemap presets + settings→source resolver (spec docs/appsettings §5.6/§7.4).
 *
 * The App Settings → Maps section offers a small set of named presets plus a
 * "Custom" URL/key. {@link basemapFromSettings} turns the persisted
 * {@link MapSourceSetting} into a concrete {@link BasemapSource} for the engine,
 * defaulting to the built-in CARTO dark basemap when nothing is configured —
 * this is the seam that makes the Maps settings actually reach the renderer.
 */
import type { BasemapSource, MapSourceSetting } from '../../../contracts';
import { DEFAULT_XYZ_SOURCE } from '../../../geo/tiles';

/** A selectable basemap preset. */
export interface BasemapPreset {
  /** Stable preset id (also the resolved {@link BasemapSource.id}). */
  readonly id: string;
  /** i18n label key under `appsettings.maps.preset.*`. */
  readonly labelKey: string;
  /** XYZ URL template, or `undefined` for the "Custom" sentinel. */
  readonly url?: string;
}

/** Sentinel preset id for a user-supplied custom source. */
export const CUSTOM_PRESET_ID = 'custom';

/**
 * Built-in basemap presets. CARTO dark is the default (matches the dark UI and
 * is not blocked from `file://` like the OSM volunteer servers).
 */
export const BASEMAP_PRESETS: readonly BasemapPreset[] = [
  {
    id: 'carto-dark',
    labelKey: 'appsettings.maps.preset.cartoDark',
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
  },
  {
    id: 'carto-light',
    labelKey: 'appsettings.maps.preset.cartoLight',
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
  },
  {
    id: 'osm',
    labelKey: 'appsettings.maps.preset.osm',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  },
  {
    id: 'esri-satellite',
    labelKey: 'appsettings.maps.preset.esriSatellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  },
  { id: CUSTOM_PRESET_ID, labelKey: 'appsettings.maps.preset.custom' },
];

/** Trimmed URL template from a settings entry, or `''`. */
function urlOf(mapSource: MapSourceSetting | undefined): string {
  return (mapSource?.urlTemplate ?? '').trim();
}

/**
 * The preset id matching the configured map source: a built-in preset when the
 * URL matches one, `'custom'` when a non-empty URL matches nothing, or the
 * default preset id when no source is configured.
 */
export function presetIdForSettings(mapSource: MapSourceSetting | undefined): string {
  const url = urlOf(mapSource);
  if (url === '') return BASEMAP_PRESETS[0]?.id ?? CUSTOM_PRESET_ID;
  const match = BASEMAP_PRESETS.find((p) => p.url === url);
  return match?.id ?? CUSTOM_PRESET_ID;
}

/**
 * Resolve the {@link BasemapSource} the engine should render from the persisted
 * map-source setting. A configured custom/preset URL wins; otherwise the
 * built-in default ({@link DEFAULT_XYZ_SOURCE}, CARTO dark) is used.
 */
export function basemapFromSettings(mapSource: MapSourceSetting | undefined): BasemapSource {
  const url = urlOf(mapSource);
  if (url === '') return DEFAULT_XYZ_SOURCE;
  const presetId = presetIdForSettings(mapSource);
  const kind: BasemapSource['kind'] = /\{bbox/i.test(url) ? 'wms' : 'xyz';
  const apiKey = mapSource?.apiKey;
  return apiKey !== undefined && apiKey !== ''
    ? { id: presetId, kind, url, apiKey }
    : { id: presetId, kind, url };
}
