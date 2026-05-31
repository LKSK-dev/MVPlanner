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
import { formatDecimal, formatInteger } from '../../../core/i18n';

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
