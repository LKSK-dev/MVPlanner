/**
 * Pure unit conversions (task T3.8; spec plan/05 §5.9, plan/04 §4.10). No DOM,
 * no globals, no locale — every function here is deterministic and unit-tested
 * ({@link file://./../../../test/unit/units.test.ts}).
 *
 * Conventions (matching the rest of the app):
 * - **Altitudes/distances** are stored and passed in **metres**.
 * - **Speeds / climb rates** are stored and passed in **metres per second**.
 * - **Temperatures** are stored and passed in **degrees Celsius**.
 *
 * All ratios are the exact internationally-defined conversion factors, so the
 * functions round-trip to floating-point precision.
 */

/** Exact metres in one international foot. */
export const M_PER_FT = 0.3048;
/** Exact metres in one international (statute) mile (`5280 ft`). */
export const M_PER_MI = 1609.344;
/** Exact metres in one nautical mile. */
export const M_PER_NM = 1852;

/** Metres-per-second in one kilometre-per-hour (`1/3.6`). */
export const MS_PER_KMH = 1 / 3.6;
/** Metres-per-second in one knot (`1852 m / 3600 s`). */
export const MS_PER_KT = M_PER_NM / 3600;
/** Metres-per-second in one mile-per-hour (`1609.344 m / 3600 s`). */
export const MS_PER_MPH = M_PER_MI / 3600;
/** Metres-per-second in one foot-per-minute (`0.3048 m / 60 s`). */
export const MS_PER_FPM = M_PER_FT / 60;

// ---------------------------------------------------------------------------
// Length (metres ↔ …)
// ---------------------------------------------------------------------------

/** Convert metres to international feet. */
export function metersToFeet(m: number): number {
  return m / M_PER_FT;
}
/** Convert international feet to metres. */
export function feetToMeters(ft: number): number {
  return ft * M_PER_FT;
}
/** Convert metres to kilometres. */
export function metersToKilometers(m: number): number {
  return m / 1000;
}
/** Convert metres to statute miles. */
export function metersToMiles(m: number): number {
  return m / M_PER_MI;
}
/** Convert metres to nautical miles. */
export function metersToNauticalMiles(m: number): number {
  return m / M_PER_NM;
}

// ---------------------------------------------------------------------------
// Speed (metres-per-second ↔ …)
// ---------------------------------------------------------------------------

/** Convert metres-per-second to kilometres-per-hour. */
export function msToKmh(v: number): number {
  return v / MS_PER_KMH;
}
/** Convert metres-per-second to knots. */
export function msToKnots(v: number): number {
  return v / MS_PER_KT;
}
/** Convert metres-per-second to miles-per-hour. */
export function msToMph(v: number): number {
  return v / MS_PER_MPH;
}
/** Convert metres-per-second to feet-per-minute (climb-rate display). */
export function msToFeetPerMinute(v: number): number {
  return v / MS_PER_FPM;
}
/** Convert feet-per-minute to metres-per-second. */
export function feetPerMinuteToMs(v: number): number {
  return v * MS_PER_FPM;
}

// ---------------------------------------------------------------------------
// Temperature
// ---------------------------------------------------------------------------

/** Convert degrees Celsius to degrees Fahrenheit. */
export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}
/** Convert degrees Fahrenheit to degrees Celsius. */
export function fahrenheitToCelsius(f: number): number {
  return ((f - 32) * 5) / 9;
}

// ---------------------------------------------------------------------------
// Unit-token dispatch (used by the formatters)
// ---------------------------------------------------------------------------

/** A length unit a distance/altitude can be displayed in. */
export type LengthUnit = 'm' | 'ft' | 'km' | 'mi' | 'nm';
/** A speed unit a velocity can be displayed in. */
export type SpeedUnit = 'm/s' | 'km/h' | 'kt' | 'mph';
/** A climb-rate unit a vertical velocity can be displayed in. */
export type ClimbUnit = 'm/s' | 'ft/min';
/** A temperature unit. */
export type TemperatureUnit = 'C' | 'F';

/** Convert a value in metres to the given {@link LengthUnit}. */
export function lengthFromMeters(m: number, unit: LengthUnit): number {
  switch (unit) {
    case 'm':
      return m;
    case 'ft':
      return metersToFeet(m);
    case 'km':
      return metersToKilometers(m);
    case 'mi':
      return metersToMiles(m);
    case 'nm':
      return metersToNauticalMiles(m);
  }
}

/** Convert a value in metres-per-second to the given {@link SpeedUnit}. */
export function speedFromMs(v: number, unit: SpeedUnit): number {
  switch (unit) {
    case 'm/s':
      return v;
    case 'km/h':
      return msToKmh(v);
    case 'kt':
      return msToKnots(v);
    case 'mph':
      return msToMph(v);
  }
}

/** Convert a value in metres-per-second to the given {@link ClimbUnit}. */
export function climbFromMs(v: number, unit: ClimbUnit): number {
  switch (unit) {
    case 'm/s':
      return v;
    case 'ft/min':
      return msToFeetPerMinute(v);
  }
}

/** Convert a value in degrees Celsius to the given {@link TemperatureUnit}. */
export function temperatureFromCelsius(c: number, unit: TemperatureUnit): number {
  switch (unit) {
    case 'C':
      return c;
    case 'F':
      return celsiusToFahrenheit(c);
  }
}
