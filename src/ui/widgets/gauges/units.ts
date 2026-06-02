/**
 * Thin unit-conversion hook for gauges (task T2.2; spec plan/04 §4.2/§4.10,
 * plan/05 §5.9).
 *
 * The full metric/imperial unit system + coordinate formats land in T3.7/T3.8
 * (`src/core/units`, `src/geo/format`). This module deliberately ships ONLY a
 * metric default plus the {@link UnitHook} seam, so the Flight screen (T2.11)
 * and later the settings store can swap in an imperial implementation without
 * touching any gauge. Each method returns the locale-formatted number string
 * plus an i18n KEY for the unit symbol — the gauge resolves the key via `t()`,
 * keeping this module free of user-facing copy.
 */
import { formatDecimal, formatInteger, formatNumber } from '../../../core/i18n';
import {
  climbFromMs,
  lengthFromMeters,
  speedFromMs,
  type ResolvedUnits,
} from '../../../core/units';

/** A formatted physical quantity: a locale number string + a unit-symbol key. */
export interface UnitFormat {
  /** Locale-formatted numeric value in the display unit. */
  value: string;
  /** i18n key resolving to the unit symbol (e.g. `gauges.unit.ms`). */
  unitKey: string;
}

/**
 * Converts unit-bearing telemetry quantities to display strings. Non-switchable
 * quantities (voltage, current, percentage, angles) are formatted directly in
 * `format.ts` and are intentionally not part of this seam.
 */
export interface UnitHook {
  /** Horizontal speed from metres/second. */
  speed(ms: number): UnitFormat;
  /** Altitude from metres. */
  altitude(m: number): UnitFormat;
  /** Distance from metres (may scale m → km). */
  distance(m: number): UnitFormat;
  /** Vertical speed (climb/sink) from metres/second. */
  climb(ms: number): UnitFormat;
}

/** Metres above which {@link metricUnits.distance} switches to kilometres. */
const KM_THRESHOLD_M = 1000;

/**
 * Default metric unit hook. Pure pass-through formatting (no conversion); the
 * imperial counterpart is provided later by T3.7/T3.8 and injected via
 * {@link GaugeProps.units}.
 */
export const metricUnits: UnitHook = {
  speed: (ms) => ({ value: formatDecimal(ms, 1), unitKey: 'gauges.unit.ms' }),
  altitude: (m) => ({ value: formatDecimal(m, 1), unitKey: 'gauges.unit.m' }),
  distance: (m) =>
    Math.abs(m) >= KM_THRESHOLD_M
      ? { value: formatDecimal(m / 1000, 2), unitKey: 'gauges.unit.km' }
      : { value: formatInteger(m), unitKey: 'gauges.unit.m' },
  climb: (ms) => ({ value: formatDecimal(ms, 1), unitKey: 'gauges.unit.ms' }),
};

/** i18n unit-symbol key for a resolved length/speed/climb token. */
const UNIT_KEY: Record<string, string> = {
  m: 'gauges.unit.m',
  ft: 'gauges.unit.ft',
  km: 'gauges.unit.km',
  mi: 'gauges.unit.mi',
  nm: 'gauges.unit.nm',
  'm/s': 'gauges.unit.ms',
  'km/h': 'gauges.unit.kmh',
  kt: 'gauges.unit.kt',
  mph: 'gauges.unit.mph',
  'ft/min': 'gauges.unit.ftmin',
};

/** Fraction digits per display unit (matches `core/units` conventions). */
function lengthDigits(unit: 'm' | 'ft' | 'km' | 'mi' | 'nm', short: boolean): number {
  if (unit === 'm' || unit === 'ft') return short ? 1 : 0;
  return 2;
}

/**
 * Build a {@link UnitHook} from the user's resolved per-quantity units
 * ({@link ResolvedUnits}, from `core/units`). This is the seam the metric default
 * always promised: the Flight gauges/HUD now honor the unit-system preset AND
 * per-quantity overrides. SI inputs are converted, locale-formatted, and tagged
 * with the matching unit-symbol key.
 */
export function unitsFromResolved(resolved: ResolvedUnits): UnitHook {
  const lengthUnit = (token: 'm' | 'ft' | 'km' | 'mi' | 'nm', m: number): UnitFormat => ({
    value: formatNumber(lengthFromMeters(m, token), {
      minimumFractionDigits: lengthDigits(token, true),
      maximumFractionDigits: lengthDigits(token, true),
    }),
    unitKey: UNIT_KEY[token] ?? 'gauges.unit.m',
  });
  return {
    altitude: (m) => lengthUnit(resolved.altitude, m),
    speed: (ms) => ({
      value: formatDecimal(speedFromMs(ms, resolved.speed), 1),
      unitKey: UNIT_KEY[resolved.speed] ?? 'gauges.unit.ms',
    }),
    climb: (ms) => ({
      value:
        resolved.verticalSpeed === 'ft/min'
          ? formatInteger(climbFromMs(ms, 'ft/min'))
          : formatDecimal(climbFromMs(ms, resolved.verticalSpeed), 1),
      unitKey: UNIT_KEY[resolved.verticalSpeed] ?? 'gauges.unit.ms',
    }),
    distance: (m) => {
      if (resolved.distance === 'auto') {
        const long = resolved.system === 'imperial' ? 'mi' : 'km';
        const short = resolved.system === 'imperial' ? 'ft' : 'm';
        const threshold = resolved.system === 'imperial' ? 1609.344 : KM_THRESHOLD_M;
        return lengthUnit(Math.abs(m) >= threshold ? long : short, m);
      }
      return lengthUnit(resolved.distance, m);
    },
  };
}
