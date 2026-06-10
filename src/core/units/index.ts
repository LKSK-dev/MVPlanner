/**
 * `core/units` public surface (task T3.8; spec plan/05 §5.9, plan/04 §4.10).
 * Dependency-free metric/imperial conversions plus locale-aware formatters for a
 * {@link UnitSystem}. Cross-module consumers (HUD, gauges, map, params) import
 * from here, never deep paths (conventions plan/implementation/00 §0.3).
 */
export {
  // ratios
  M_PER_FT,
  M_PER_MI,
  M_PER_NM,
  MS_PER_KMH,
  MS_PER_KT,
  MS_PER_MPH,
  MS_PER_FPM,
  // length
  metersToFeet,
  feetToMeters,
  metersToKilometers,
  metersToMiles,
  metersToNauticalMiles,
  // speed / climb
  msToKmh,
  msToKnots,
  msToMph,
  msToFeetPerMinute,
  feetPerMinuteToMs,
  // temperature
  celsiusToFahrenheit,
  fahrenheitToCelsius,
  // unit-token dispatch
  lengthFromMeters,
  speedFromMs,
  climbFromMs,
  temperatureFromCelsius,
  type LengthUnit,
  type SpeedUnit,
  type ClimbUnit,
  type TemperatureUnit,
} from './convert';

export {
  resolveUnits,
  createUnitFormatter,
  unitFormatterFor,
  type ResolvedUnits,
  type UnitFormatter,
} from './preferences';
export {
  formatBytes,
  formatDurationSeconds,
  formatAltitude,
  formatDistance,
  formatSpeed,
  formatClimb,
  formatTemperature,
  formatVoltage,
  formatCurrent,
  formatPercent,
  formatAngle,
  type Unit,
  type FormatOptions,
  type DistanceFormatOptions,
  type SpeedFormatOptions,
  type ClimbFormatOptions,
} from './format';
