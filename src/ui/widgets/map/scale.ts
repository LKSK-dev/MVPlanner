/**
 * Map scale-bar geometry (task: map UX; spec plan/04 §4.2 map, plan/05 §5.8).
 *
 * Pure, engine-independent helpers that turn the current camera into a
 * "nice" scale bar — a round ground distance (1 / 2 / 5 × 10ⁿ) that fits a
 * target pixel budget — without touching the canvas engine. The widget feeds in
 * `lat`/`zoom` (from `engine.getView()`) and the device-pixel ratio; everything
 * here is deterministic and unit-tested.
 *
 * Pixel-space note: the engine renders into a HiDPI canvas where 1 world pixel
 * equals 1 *device* pixel (see `geo/tiles` `projectToScreen`). The scale bar is
 * a CSS-pixel DOM overlay, so the widget converts metres-per-device-pixel to
 * metres-per-CSS-pixel by multiplying {@link groundResolution} by the device
 * pixel ratio before calling {@link niceScale}.
 */
import { M_PER_FT, M_PER_MI } from '../../../core/units';
import type { UnitSystem } from '../../../contracts';

/**
 * Web-Mercator ground resolution at the equator for zoom 0 with 256-px tiles:
 * metres per pixel = `EARTH_CIRCUMFERENCE / 256`.
 */
const EQUATOR_METERS_PER_PIXEL = 156543.03392;

/** Display unit a {@link ScaleBar} can be expressed in. */
export type ScaleUnit = 'm' | 'km' | 'ft' | 'mi';

/** A resolved scale bar: a round distance and the pixel span that draws it. */
export interface ScaleBar {
  /** The round ground distance the bar represents, in **metres**. */
  readonly meters: number;
  /** The bar length in the same pixel space as the `metersPerPixel` input. */
  readonly pixels: number;
  /** The round value expressed in {@link unit} (always of the form 1/2/5 × 10ⁿ). */
  readonly value: number;
  /** The display unit chosen for {@link value}. */
  readonly unit: ScaleUnit;
  /** A ready-to-render label, e.g. `"500 m"`, `"2 km"`, `"200 ft"`, `"5 mi"`. */
  readonly label: string;
}

/** A zero-length bar, returned for degenerate inputs (no camera / no canvas). */
const EMPTY_BAR: ScaleBar = { meters: 0, pixels: 0, value: 0, unit: 'm', label: '' };

/**
 * Web-Mercator ground resolution in **metres per pixel** at a latitude and
 * (fractional) zoom, for the standard 256-px tile scheme:
 *
 * `156543.03392 · cos(lat) / 2^zoom`.
 *
 * @param lat  Centre latitude in degrees (WGS84).
 * @param zoom Fractional map zoom level.
 * @returns Metres covered by one map pixel; `NaN`/`Infinity` propagate for
 *   non-finite inputs (the caller guards via {@link niceScale}).
 */
export function groundResolution(lat: number, zoom: number): number {
  return (EQUATOR_METERS_PER_PIXEL * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

/**
 * Largest value of the form `1/2/5 × 10ⁿ` that is `<= max`. Returns `0` for a
 * non-positive or non-finite `max`.
 */
function niceCeilingBelow(max: number): number {
  if (!(max > 0) || !Number.isFinite(max)) return 0;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const fraction = max / magnitude; // in [1, 10)
  const mantissa = fraction >= 5 ? 5 : fraction >= 2 ? 2 : 1;
  return mantissa * magnitude;
}

/**
 * Resolve a {@link ScaleBar} for a given resolution and pixel budget.
 *
 * Picks the largest round distance (1/2/5 × 10ⁿ) whose pixel length does not
 * exceed `maxPixels`, then auto-selects the display unit: metric `m → km` at
 * 1 km, imperial `ft → mi` at 1 mile.
 *
 * @param metersPerPixel Ground distance per pixel in the target pixel space
 *   (the widget passes metres-per-CSS-pixel = {@link groundResolution} × dpr).
 * @param maxPixels      The maximum bar length in pixels (the budget the bar
 *   must fit within; e.g. ~120).
 * @param system         Unit system for the label (default `'metric'`).
 * @returns The resolved bar; a zero-length {@link ScaleBar} for invalid inputs.
 */
export function niceScale(
  metersPerPixel: number,
  maxPixels: number,
  system: UnitSystem = 'metric',
): ScaleBar {
  if (!(metersPerPixel > 0) || !Number.isFinite(metersPerPixel) || !(maxPixels > 0)) {
    return EMPTY_BAR;
  }
  const maxMeters = metersPerPixel * maxPixels;

  let value: number;
  let unit: ScaleUnit;
  let meters: number;

  if (system === 'imperial') {
    const maxFeet = maxMeters / M_PER_FT;
    if (maxFeet >= M_PER_MI / M_PER_FT) {
      // 1 mile (5280 ft) or more fits ⇒ a miles bar reads cleaner.
      value = niceCeilingBelow(maxMeters / M_PER_MI);
      unit = 'mi';
      meters = value * M_PER_MI;
    } else {
      value = niceCeilingBelow(maxFeet);
      unit = 'ft';
      meters = value * M_PER_FT;
    }
  } else if (maxMeters >= 1000) {
    value = niceCeilingBelow(maxMeters / 1000);
    unit = 'km';
    meters = value * 1000;
  } else {
    value = niceCeilingBelow(maxMeters);
    unit = 'm';
    meters = value;
  }

  if (!(meters > 0)) return EMPTY_BAR;
  return { meters, pixels: meters / metersPerPixel, value, unit, label: `${value} ${unit}` };
}
