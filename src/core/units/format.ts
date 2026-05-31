/**
 * Locale-aware unit formatters for a {@link UnitSystem} (task T3.8; spec
 * plan/05 §5.9, plan/04 §4.10). Each formatter takes a value in the app's
 * canonical SI base (metres, metres-per-second, degrees Celsius — see
 * {@link ./convert}), converts it for the active system, and renders a
 * localized number (via the i18n {@link formatNumber}) with a unit suffix.
 *
 * The **number** is locale-aware (decimal separator, digit grouping); the unit
 * **symbol** is locale-independent (`m`, `ft`, `kt`, `°C`, …) per common GCS /
 * aviation convention.
 */
import type { UnitSystem } from '../../contracts';
import { formatNumber } from '../i18n';
import {
  climbFromMs,
  lengthFromMeters,
  speedFromMs,
  temperatureFromCelsius,
  type ClimbUnit,
  type LengthUnit,
  type SpeedUnit,
  type TemperatureUnit,
} from './convert';

/** Every unit token a formatter can emit (used for symbol/precision lookup). */
export type Unit = LengthUnit | SpeedUnit | ClimbUnit | TemperatureUnit | 'V' | 'A' | '%' | 'deg';

/** Human-readable suffix symbol for each {@link Unit}. */
const UNIT_SYMBOL: Record<Unit, string> = {
  m: 'm',
  ft: 'ft',
  km: 'km',
  mi: 'mi',
  nm: 'nm',
  'm/s': 'm/s',
  'km/h': 'km/h',
  kt: 'kt',
  mph: 'mph',
  'ft/min': 'ft/min',
  C: '°C',
  F: '°F',
  V: 'V',
  A: 'A',
  '%': '%',
  deg: '°',
};

/** Default fraction-digit count for each {@link Unit}. */
const DEFAULT_FRACTION: Record<Unit, number> = {
  m: 1,
  ft: 0,
  km: 2,
  mi: 2,
  nm: 2,
  'm/s': 1,
  'km/h': 1,
  kt: 1,
  mph: 1,
  'ft/min': 0,
  C: 1,
  F: 1,
  V: 1,
  A: 1,
  '%': 0,
  deg: 0,
};

/** Units whose suffix abuts the number with no separating space (`78%`, `45°`). */
const NO_SPACE: ReadonlySet<Unit> = new Set<Unit>(['%', 'deg']);

/** Common options shared by every formatter. */
export interface FormatOptions {
  /** Override the default fraction-digit count for the chosen unit. */
  fractionDigits?: number;
  /** Append the unit symbol (default `true`); when `false`, just the number. */
  withUnit?: boolean;
}

/** Render `value` (already in display unit) as a localized string + suffix. */
function render(value: number, unit: Unit, opts?: FormatOptions): string {
  const digits = opts?.fractionDigits ?? DEFAULT_FRACTION[unit];
  const num = formatNumber(value, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (opts?.withUnit === false) return num;
  const sym = UNIT_SYMBOL[unit];
  return NO_SPACE.has(unit) ? `${num}${sym}` : `${num} ${sym}`;
}

/**
 * Format an **altitude** (input metres). Metric → `m`, imperial → `ft`.
 */
export function formatAltitude(value_m: number, system: UnitSystem, opts?: FormatOptions): string {
  const unit: LengthUnit = system === 'imperial' ? 'ft' : 'm';
  return render(lengthFromMeters(value_m, unit), unit, opts);
}

/** Options for {@link formatDistance}. */
export interface DistanceFormatOptions extends FormatOptions {
  /** Force a specific unit instead of auto-scaling short ↔ long. */
  unit?: LengthUnit;
  /** Long-distance unit when auto-scaling (default: `km` metric, `mi` imperial). */
  longUnit?: 'km' | 'mi' | 'nm';
  /** Threshold in **metres** above which to switch to the long unit. */
  longThresholdM?: number;
}

/**
 * Format a **distance** (input metres). Auto-scales short → long once the value
 * passes a threshold: metric `m → km`, imperial `ft → mi` (or `nm`). Pass
 * `opts.unit` to force a single unit, or `opts.longUnit`/`opts.longThresholdM`
 * to tune the scaling.
 */
export function formatDistance(
  value_m: number,
  system: UnitSystem,
  opts?: DistanceFormatOptions,
): string {
  let unit: LengthUnit;
  if (opts?.unit) {
    unit = opts.unit;
  } else {
    let shortUnit: LengthUnit;
    let longUnit: LengthUnit;
    let threshold: number;
    if (system === 'imperial') {
      shortUnit = 'ft';
      longUnit = opts?.longUnit ?? 'mi';
      threshold = opts?.longThresholdM ?? (longUnit === 'nm' ? 1852 : 1609.344);
    } else {
      shortUnit = 'm';
      longUnit = opts?.longUnit ?? 'km';
      threshold = opts?.longThresholdM ?? (longUnit === 'nm' ? 1852 : 1000);
    }
    unit = Math.abs(value_m) >= threshold ? longUnit : shortUnit;
  }
  // Distances read in whole short units (m/ft) and 2-decimal long units; this
  // differs from altitude, where bare metres keep one decimal.
  const fractionDigits = opts?.fractionDigits ?? (unit === 'm' || unit === 'ft' ? 0 : 2);
  return render(lengthFromMeters(value_m, unit), unit, { ...opts, fractionDigits });
}

/** Options for {@link formatSpeed}. */
export interface SpeedFormatOptions extends FormatOptions {
  /** Force a specific speed unit (e.g. `kt` for an imperial/aviation display). */
  unit?: SpeedUnit;
}

/**
 * Format a **speed** (input metres-per-second). Metric → `m/s`, imperial →
 * `mph` by default; pass `opts.unit` for `km/h` or `kt`.
 */
export function formatSpeed(
  value_ms: number,
  system: UnitSystem,
  opts?: SpeedFormatOptions,
): string {
  const unit: SpeedUnit = opts?.unit ?? (system === 'imperial' ? 'mph' : 'm/s');
  return render(speedFromMs(value_ms, unit), unit, opts);
}

/** Options for {@link formatClimb}. */
export interface ClimbFormatOptions extends FormatOptions {
  /** Force a specific climb-rate unit. */
  unit?: ClimbUnit;
}

/**
 * Format a **climb rate** (input metres-per-second). Metric → `m/s`, imperial →
 * `ft/min` (the conventional vertical-speed display).
 */
export function formatClimb(
  value_ms: number,
  system: UnitSystem,
  opts?: ClimbFormatOptions,
): string {
  const unit: ClimbUnit = opts?.unit ?? (system === 'imperial' ? 'ft/min' : 'm/s');
  return render(climbFromMs(value_ms, unit), unit, opts);
}

/**
 * Format a **temperature** (input degrees Celsius). Metric → `°C`, imperial →
 * `°F`.
 */
export function formatTemperature(
  value_c: number,
  system: UnitSystem,
  opts?: FormatOptions,
): string {
  const unit: TemperatureUnit = system === 'imperial' ? 'F' : 'C';
  return render(temperatureFromCelsius(value_c, unit), unit, opts);
}

// ---------------------------------------------------------------------------
// Pass-throughs (no metric/imperial switch): voltage, current, percent, angle
// ---------------------------------------------------------------------------

/** Format a voltage in volts (`V`); system-independent. */
export function formatVoltage(volts: number, opts?: FormatOptions): string {
  return render(volts, 'V', opts);
}
/** Format a current in amps (`A`); system-independent. */
export function formatCurrent(amps: number, opts?: FormatOptions): string {
  return render(amps, 'A', opts);
}
/** Format a percentage (`%`); system-independent. */
export function formatPercent(pct: number, opts?: FormatOptions): string {
  return render(pct, '%', opts);
}
/** Format an angle in degrees (`°`); system-independent. */
export function formatAngle(deg: number, opts?: FormatOptions): string {
  return render(deg, 'deg', opts);
}
