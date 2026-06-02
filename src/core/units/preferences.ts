/**
 * Per-quantity unit preferences (App Settings → Units, spec docs/appsettings
 * SPEC-0.3 §4). Resolves the {@link AppSettings.units} preset + optional
 * {@link UnitPreferences} overrides into a concrete unit per quantity, and
 * builds a formatter facade over `core/units` + `geo/format` so any surface can
 * render values in the user's chosen units (fixing metric-only displays).
 *
 * Pure + DOM-free; unit-tested.
 */
import type { AppSettings, CoordinateFormat, UnitPreferences, UnitSystem } from '../../contracts';
import {
  formatAltitude,
  formatAngle,
  formatClimb,
  formatDistance,
  formatSpeed,
  formatTemperature,
} from './format';
import type { ClimbUnit, SpeedUnit } from './convert';
import { formatNumber } from '../i18n';
import { formatLatLon } from '../../geo/format';

/** Concrete unit per quantity after resolving preset + overrides. */
export interface ResolvedUnits {
  /** The preset, used for auto-scaling distance + fallbacks. */
  readonly system: UnitSystem;
  readonly altitude: 'm' | 'ft';
  /** `'auto'` = preset auto-scale (m↔km / ft↔mi); else a forced length unit. */
  readonly distance: 'auto' | 'm' | 'km' | 'ft' | 'mi' | 'nm';
  readonly speed: SpeedUnit;
  readonly verticalSpeed: ClimbUnit;
  readonly temperature: 'C' | 'F';
  readonly coordinate: CoordinateFormat;
  readonly heading: 'deg' | 'mil';
}

/** Mils per full turn (NATO mil); used for the `'mil'` heading unit. */
const MILS_PER_TURN = 6400;

/** Resolve the per-quantity defaults for a preset. */
function presetUnits(system: UnitSystem): Omit<ResolvedUnits, 'coordinate'> {
  const imperial = system === 'imperial';
  return {
    system,
    altitude: imperial ? 'ft' : 'm',
    distance: 'auto',
    speed: imperial ? 'mph' : 'm/s',
    verticalSpeed: imperial ? 'ft/min' : 'm/s',
    temperature: imperial ? 'F' : 'C',
    heading: 'deg',
  };
}

/**
 * Resolve concrete units from settings: each quantity uses its
 * {@link UnitPreferences} override when set, else the {@link AppSettings.units}
 * preset default. Coordinates fall back to {@link AppSettings.coordinateFormat}.
 */
export function resolveUnits(settings: AppSettings): ResolvedUnits {
  const base = presetUnits(settings.units);
  const p: UnitPreferences = settings.unitPreferences ?? {};
  return {
    system: base.system,
    altitude: p.altitude ?? base.altitude,
    distance: p.distance ?? base.distance,
    speed: p.speed ?? base.speed,
    verticalSpeed: p.verticalSpeed ?? base.verticalSpeed,
    temperature: p.temperature ?? base.temperature,
    coordinate: p.coordinate ?? settings.coordinateFormat,
    heading: p.heading ?? base.heading,
  };
}

/** A formatter bound to resolved units (input values are SI base). */
export interface UnitFormatter {
  altitude(meters: number): string;
  distance(meters: number): string;
  speed(metersPerSecond: number): string;
  climb(metersPerSecond: number): string;
  temperature(celsius: number): string;
  heading(degrees: number): string;
  coordinate(lat: number, lon: number): string;
  readonly units: ResolvedUnits;
}

/** Build a {@link UnitFormatter} for the given resolved units. */
export function createUnitFormatter(units: ResolvedUnits): UnitFormatter {
  const altSystem: UnitSystem = units.altitude === 'ft' ? 'imperial' : 'metric';
  const tempSystem: UnitSystem = units.temperature === 'F' ? 'imperial' : 'metric';
  return {
    units,
    altitude: (m) => formatAltitude(m, altSystem),
    distance: (m) =>
      units.distance === 'auto'
        ? formatDistance(m, units.system)
        : formatDistance(m, units.system, { unit: units.distance }),
    speed: (ms) => formatSpeed(ms, units.system, { unit: units.speed }),
    climb: (ms) => formatClimb(ms, units.system, { unit: units.verticalSpeed }),
    temperature: (c) => formatTemperature(c, tempSystem),
    heading: (deg) =>
      units.heading === 'mil'
        ? `${formatNumber((deg * MILS_PER_TURN) / 360, { maximumFractionDigits: 0 })} mil`
        : formatAngle(deg),
    coordinate: (lat, lon) => formatLatLon(lat, lon, units.coordinate),
  };
}

/** Convenience: build a formatter straight from settings. */
export function unitFormatterFor(settings: AppSettings): UnitFormatter {
  return createUnitFormatter(resolveUnits(settings));
}
