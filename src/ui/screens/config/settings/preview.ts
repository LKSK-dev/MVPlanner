/**
 * Live unit/coordinate preview model for the Settings screen (task T3.7; spec
 * plan/05 §5.4 Settings, plan/05 §5.9). Pure + DOM-free so it unit-tests in
 * isolation: it maps the chosen {@link AppSettings} unit system + coordinate
 * format to formatted sample values using the shared `core/units` +
 * `geo/format` utilities (the same ones HUD/map/params use), so the user sees
 * exactly how their choice renders before committing it elsewhere.
 */
import type { AppSettings } from '../../../../contracts';
import { formatAltitude, formatDistance, formatSpeed } from '../../../../core/units';
import { formatLatLon } from '../../../../geo/format';

/** A fixed, recognizable sample point + magnitudes used for the preview. */
export const PREVIEW_SAMPLE = {
  /** Sample latitude (San Francisco), WGS84 degrees. */
  lat: 37.7749,
  /** Sample longitude (San Francisco), WGS84 degrees. */
  lon: -122.4194,
  /** Sample altitude in metres. */
  altitudeM: 120,
  /** Sample distance in metres. */
  distanceM: 1500,
  /** Sample speed in metres-per-second. */
  speedMs: 12,
} as const;

/** Formatted preview strings for the current unit/coordinate selection. */
export interface SettingsPreview {
  /** Sample coordinate rendered in the chosen {@link AppSettings.coordinateFormat}. */
  coordinate: string;
  /** Sample altitude rendered in the chosen {@link AppSettings.units}. */
  altitude: string;
  /** Sample distance rendered in the chosen {@link AppSettings.units}. */
  distance: string;
  /** Sample speed rendered in the chosen {@link AppSettings.units}. */
  speed: string;
}

/**
 * Build the live preview for a unit system + coordinate format. Only the two
 * relevant settings fields are read, so the preview recomputes exactly when one
 * of them changes.
 */
export function buildPreview(
  settings: Pick<AppSettings, 'units' | 'coordinateFormat'>,
): SettingsPreview {
  return {
    coordinate: formatLatLon(PREVIEW_SAMPLE.lat, PREVIEW_SAMPLE.lon, settings.coordinateFormat),
    altitude: formatAltitude(PREVIEW_SAMPLE.altitudeM, settings.units),
    distance: formatDistance(PREVIEW_SAMPLE.distanceM, settings.units),
    speed: formatSpeed(PREVIEW_SAMPLE.speedMs, settings.units),
  };
}
