/**
 * Pure HUD draw-model, geometry and value formatting (task T2.1; spec
 * plan/04 §4.2 HUD, plan/05 §5.5/§5.8).
 *
 * Everything here is side-effect-free and DOM-free so it is unit-testable
 * without a browser (the canvas 2d calls live in `./render`). It turns a
 * {@link VehicleState} into:
 *
 *  - the geometric inputs the renderer needs (roll/pitch/heading, pitch-ladder
 *    rungs, heading-tape ticks, the pitch→pixels mapping), and
 *  - the formatted, locale-agnostic readout strings (speeds, altitudes, climb,
 *    battery, GPS, EKF/vibe, time), plus
 *  - a textual a11y summary (mode / armed / altitude / speed / battery) that the
 *    component mirrors into a visually-hidden live region (spec §5.8 — a canvas
 *    needs a text equivalent).
 *
 * Speed/altitude/climb readouts go through an optional {@link UnitHook}
 * (default {@link metricUnits}), so the HUD honours the selected unit system
 * beside the unit-aware gauges; everything else stays SI.
 */
import type { VehicleState } from '../../../contracts';
import { metricUnits, type UnitFormat, type UnitHook } from '../gauges';

/** Placeholder shown for an unavailable value. */
export const HUD_DASH = '\u2014';

/** Colour roles the {@link import('./render').drawHud} renderer consumes. */
export interface HudColors {
  /** Upper-half (sky) fill. */
  sky: string;
  /** Lower-half (ground) fill. */
  ground: string;
  /** Horizon line + pitch ladder ink. */
  horizon: string;
  /** Pitch-ladder rung ink. */
  ladder: string;
  /** Primary readout text. */
  text: string;
  /** Secondary / dimmed text. */
  textDim: string;
  /** Accent (heading pointer, highlights). */
  accent: string;
  /** Nominal / ok status. */
  ok: string;
  /** Caution status. */
  warn: string;
  /** Alarm / armed status. */
  error: string;
}

/** Field labels (i18n-resolved by the component; English defaults here). */
export interface HudLabels {
  armed: string;
  disarmed: string;
  mode: string;
  airspeed: string;
  groundspeed: string;
  altRel: string;
  altAmsl: string;
  climb: string;
  throttle: string;
  battery: string;
  gps: string;
  ekf: string;
  vibe: string;
  heading: string;
  time: string;
  noVehicle: string;
  a11yAltitude: string;
  a11ySpeed: string;
  a11yBattery: string;
}

/** English fallback labels — used by tests and when no i18n is supplied. */
export const DEFAULT_HUD_LABELS: HudLabels = {
  armed: 'ARMED',
  disarmed: 'DISARMED',
  mode: 'Mode',
  airspeed: 'AS',
  groundspeed: 'GS',
  altRel: 'ALT',
  altAmsl: 'AMSL',
  climb: 'CLB',
  throttle: 'THR',
  battery: 'BAT',
  gps: 'GPS',
  ekf: 'EKF',
  vibe: 'VIB',
  heading: 'HDG',
  time: 'TIME',
  noVehicle: 'No vehicle data',
  a11yAltitude: 'altitude',
  a11ySpeed: 'speed',
  a11yBattery: 'battery',
};

/** Formatted readout strings the renderer paints next to their labels. */
export interface HudReadouts {
  airspeed: string;
  groundspeed: string;
  altRel: string;
  altAmsl: string;
  climb: string;
  throttle: string;
  battery: string;
  gps: string;
  ekf: string;
  vibe: string;
  heading: string;
  time: string;
}

/** A complete, render-ready HUD frame derived from a {@link VehicleState}. */
export interface HudModel {
  /** Whether a vehicle was supplied (drives the empty state). */
  hasVehicle: boolean;
  /** Roll in radians (right-wing-down positive). */
  rollRad: number;
  /** Pitch in radians (nose-up positive). */
  pitchRad: number;
  /** Heading in degrees, wrapped to [0, 360). */
  headingDeg: number;
  /** Armed flag (drives the prominent ARMED indicator). */
  armed: boolean;
  /** Flight-mode string. */
  mode: string;
  /** Formatted readouts. */
  readouts: HudReadouts;
  /** STATUSTEXT ticker line (empty when none). */
  statusText: string;
  /** Textual screen-reader summary. */
  a11ySummary: string;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180;

/** Radians → degrees. */
export function radToDeg(rad: number): number {
  return rad * RAD2DEG;
}

/** Degrees → radians. */
export function degToRad(deg: number): number {
  return deg * DEG2RAD;
}

/** Wrap an angle (degrees) to the half-open range [0, 360). */
export function wrapDeg360(deg: number): number {
  const m = deg % 360;
  return m < 0 ? m + 360 : m;
}

/** Wrap an angle (degrees) to the shortest-signed range (-180, 180]. */
export function wrapDeg180(deg: number): number {
  const m = wrapDeg360(deg);
  return m > 180 ? m - 360 : m;
}

/**
 * Vertical pixel offset of the horizon/ladder for a given pitch. A positive
 * pitch (nose up) moves the horizon DOWN the screen, so the offset is positive
 * downward — the renderer translates the ladder by this amount.
 */
export function pitchPixels(pitchRad: number, pxPerDeg: number): number {
  return radToDeg(pitchRad) * pxPerDeg;
}

/** One pitch-ladder rung. */
export interface PitchRung {
  /** Rung pitch in degrees (signed; positive = climb). */
  deg: number;
  /** Absolute degree label, e.g. `10`. */
  label: number;
}

/**
 * Pitch-ladder rungs visible around `pitchDeg`, every `stepDeg` within
 * ±`halfRangeDeg`, excluding the 0° horizon (drawn separately). Sorted
 * descending so the renderer paints top-to-bottom.
 */
export function pitchLadderRungs(pitchDeg: number, halfRangeDeg = 30, stepDeg = 10): PitchRung[] {
  const lo = Math.ceil((pitchDeg - halfRangeDeg) / stepDeg) * stepDeg;
  const hi = Math.floor((pitchDeg + halfRangeDeg) / stepDeg) * stepDeg;
  const rungs: PitchRung[] = [];
  for (let d = hi; d >= lo; d -= stepDeg) {
    if (d === 0) continue;
    rungs.push({ deg: d, label: Math.abs(d) });
  }
  return rungs;
}

/** One heading-tape tick. */
export interface HeadingTick {
  /** Compass bearing of the tick, wrapped to [0, 360). */
  deg: number;
  /** Signed offset from the current heading (negative = left). */
  deltaDeg: number;
  /** Whether this is a major (multiple of 30°) tick. */
  major: boolean;
}

/**
 * Heading-tape ticks around `headingDeg`, every `stepDeg` within
 * ±`halfRangeDeg`. `deltaDeg` is the shortest signed distance to the heading so
 * the renderer can place ticks left/right of centre. Sorted left→right.
 */
export function headingTapeTicks(
  headingDeg: number,
  halfRangeDeg = 45,
  stepDeg = 10,
): HeadingTick[] {
  const lo = Math.ceil((headingDeg - halfRangeDeg) / stepDeg) * stepDeg;
  const hi = Math.floor((headingDeg + halfRangeDeg) / stepDeg) * stepDeg;
  const ticks: HeadingTick[] = [];
  for (let d = lo; d <= hi; d += stepDeg) {
    const deg = wrapDeg360(d);
    ticks.push({ deg, deltaDeg: d - headingDeg, major: deg % 30 === 0 });
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// Value formatting (locale-agnostic)
// ---------------------------------------------------------------------------

/**
 * Unit-symbol text per `gauges.unit.*` i18n key. The model is pure/DOM-free and
 * deliberately does not pull the i18n runtime; these SI/imperial symbols are
 * locale-invariant, so a static map keeps the HUD strings testable offline.
 */
const UNIT_SYMBOLS: Readonly<Record<string, string>> = {
  'gauges.unit.ms': 'm/s',
  'gauges.unit.m': 'm',
  'gauges.unit.km': 'km',
  'gauges.unit.ft': 'ft',
  'gauges.unit.mi': 'mi',
  'gauges.unit.nm': 'nm',
  'gauges.unit.kmh': 'km/h',
  'gauges.unit.kt': 'kt',
  'gauges.unit.mph': 'mph',
  'gauges.unit.ftmin': 'ft/min',
};

/** Render a {@link UnitFormat} as `value symbol` text. */
function unitText(f: UnitFormat): string {
  return `${f.value} ${UNIT_SYMBOLS[f.unitKey] ?? f.unitKey}`;
}

/** Format an altitude (m) via `units`, or a dash when missing. */
export function fmtMeters(m: number | undefined, units: UnitHook = metricUnits): string {
  return m === undefined ? HUD_DASH : unitText(units.altitude(m));
}

/** Format a speed (m/s) via `units`, or a dash when missing. */
export function fmtSpeed(ms: number | undefined, units: UnitHook = metricUnits): string {
  return ms === undefined ? HUD_DASH : unitText(units.speed(ms));
}

/** Format a climb rate (m/s) with an explicit sign via `units`, or a dash. */
export function fmtClimb(ms: number | undefined, units: UnitHook = metricUnits): string {
  if (ms === undefined) return HUD_DASH;
  const sign = ms >= 0 ? '+' : '';
  return `${sign}${unitText(units.climb(ms))}`;
}

/** Format a throttle percentage, or a dash when missing. */
export function fmtThrottle(pct: number | undefined): string {
  return pct === undefined ? HUD_DASH : `${Math.round(pct)}%`;
}

/** Format battery voltage and/or remaining percent, or a dash when both miss. */
export function fmtBattery(voltageV: number | undefined, remainingPct: number | undefined): string {
  const parts: string[] = [];
  if (voltageV !== undefined) parts.push(`${voltageV.toFixed(1)} V`);
  if (remainingPct !== undefined) parts.push(`${Math.round(remainingPct)}%`);
  return parts.length === 0 ? HUD_DASH : parts.join(' \u00b7 ');
}

/** Map a `GPS_FIX_TYPE` value to a short label. */
export function gpsFixLabel(fix: number | undefined): string {
  switch (fix) {
    case 0:
      return 'NO GPS';
    case 1:
      return 'NO FIX';
    case 2:
      return '2D';
    case 3:
      return '3D';
    case 4:
      return 'DGPS';
    case 5:
      return 'RTK FLOAT';
    case 6:
      return 'RTK FIXED';
    default:
      return HUD_DASH;
  }
}

/** Format GPS fix + satellite count, or a dash when unavailable. */
export function fmtGps(fix: number | undefined, sats: number | undefined): string {
  if (fix === undefined && sats === undefined) return HUD_DASH;
  const label = gpsFixLabel(fix);
  return sats === undefined ? label : `${label} \u00b7 ${sats}`;
}

/** Format the EKF health flag, or a dash when unknown. */
export function fmtEkf(ekfOk: boolean | undefined): string {
  if (ekfOk === undefined) return HUD_DASH;
  return ekfOk ? 'OK' : 'BAD';
}

/** Format the worst-axis vibration magnitude, or a dash when unavailable. */
export function fmtVibe(vibe: VehicleState['vibe']): string {
  if (vibe === undefined) return HUD_DASH;
  const max = Math.max(Math.abs(vibe.x), Math.abs(vibe.y), Math.abs(vibe.z));
  return max.toFixed(0);
}

/** Format a heading in degrees as a zero-padded `041\u00b0` string. */
export function fmtHeading(deg: number): string {
  // Round first, then re-wrap so 359.6° reads 000° (not 360°).
  const d = wrapDeg360(Math.round(wrapDeg360(deg)));
  return `${d.toString().padStart(3, '0')}\u00b0`;
}

/** Format epoch-ms as a 24h `HH:MM:SS` clock (local time). */
export function fmtClock(nowMs: number): string {
  const d = new Date(nowMs);
  const p = (n: number): string => n.toString().padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// Model assembly
// ---------------------------------------------------------------------------

/**
 * Build the screen-reader summary (mode / armed / altitude / speed / battery)
 * for `vehicle`. Pure so it can be reused by the live a11y region and tested.
 */
export function hudA11ySummary(
  vehicle: VehicleState | undefined,
  labels: HudLabels = DEFAULT_HUD_LABELS,
  units: UnitHook = metricUnits,
): string {
  if (vehicle === undefined) return labels.noVehicle;
  const armedWord = vehicle.armed ? labels.armed : labels.disarmed;
  const speedMs = vehicle.velocity?.airMs ?? vehicle.velocity?.groundMs;
  const parts = [
    `${labels.mode} ${vehicle.mode}`,
    armedWord,
    `${labels.a11yAltitude} ${fmtMeters(vehicle.position?.altRelM, units)}`,
    `${labels.a11ySpeed} ${fmtSpeed(speedMs, units)}`,
    `${labels.a11yBattery} ${fmtBattery(vehicle.battery?.voltageV, vehicle.battery?.remainingPct)}`,
  ];
  return parts.join(', ');
}

/**
 * Cheap fingerprint of a {@link UnitHook}'s display units, appended to the
 * frame signature so a live units change repaints the HUD readouts.
 */
export function unitsSignature(units: UnitHook): string {
  return `${units.speed(0).unitKey}|${units.altitude(0).unitKey}|${units.climb(0).unitKey}`;
}

/**
 * A cheap change-signature over the inputs that affect the rendered frame,
 * quantised so sub-pixel jitter does not force needless repaints. The component
 * compares this between animation frames and only rebuilds + redraws when it
 * changes (plus on resize). `second` is the time readout's 1 Hz tick.
 */
export function hudSignature(
  vehicle: VehicleState | undefined,
  statusText: string | undefined,
  second: number,
): string {
  if (vehicle === undefined) return `none|${statusText ?? ''}|${second}`;
  const q = (n: number | undefined, f: number): string =>
    n === undefined ? '_' : Math.round(n * f).toString();
  const v = vehicle;
  return [
    v.armed ? 'A' : 'D',
    v.mode,
    q(v.attitude.rollRad, 100),
    q(v.attitude.pitchRad, 100),
    q(v.attitude.yawRad, 50),
    q(v.position?.altRelM, 10),
    q(v.position?.altAmslM, 10),
    q(v.velocity?.groundMs, 10),
    q(v.velocity?.airMs, 10),
    q(v.velocity?.climbMs, 10),
    q(v.throttlePct, 1),
    q(v.battery?.voltageV, 10),
    q(v.battery?.remainingPct, 1),
    q(v.gps?.fix, 1),
    q(v.gps?.sats, 1),
    v.ekfOk === undefined ? '_' : v.ekfOk ? '1' : '0',
    statusText ?? '',
    second,
  ].join('|');
}

/**
 * Build a complete {@link HudModel} from a (possibly undefined) vehicle, the
 * current STATUSTEXT line and the wall clock. Pure; the renderer consumes the
 * result and `labels` to paint a frame.
 */
export function buildHudModel(
  vehicle: VehicleState | undefined,
  statusText: string | undefined,
  nowMs: number,
  labels: HudLabels = DEFAULT_HUD_LABELS,
  units: UnitHook = metricUnits,
): HudModel {
  const readouts: HudReadouts = {
    airspeed: fmtSpeed(vehicle?.velocity?.airMs, units),
    groundspeed: fmtSpeed(vehicle?.velocity?.groundMs, units),
    altRel: fmtMeters(vehicle?.position?.altRelM, units),
    altAmsl: fmtMeters(vehicle?.position?.altAmslM, units),
    climb: fmtClimb(vehicle?.velocity?.climbMs, units),
    // Throttle output % from `VFR_HUD.throttle`, surfaced on `VehicleState`
    // (T2.4 enrichment); a dash when the field is absent.
    throttle: fmtThrottle(vehicle?.throttlePct),
    battery: fmtBattery(vehicle?.battery?.voltageV, vehicle?.battery?.remainingPct),
    gps: fmtGps(vehicle?.gps?.fix, vehicle?.gps?.sats),
    ekf: fmtEkf(vehicle?.ekfOk),
    vibe: fmtVibe(vehicle?.vibe),
    heading: vehicle === undefined ? HUD_DASH : fmtHeading(radToDeg(vehicle.attitude.yawRad)),
    time: fmtClock(nowMs),
  };

  return {
    hasVehicle: vehicle !== undefined,
    rollRad: vehicle?.attitude.rollRad ?? 0,
    pitchRad: vehicle?.attitude.pitchRad ?? 0,
    headingDeg: vehicle === undefined ? 0 : wrapDeg360(radToDeg(vehicle.attitude.yawRad)),
    armed: vehicle?.armed ?? false,
    mode: vehicle?.mode ?? HUD_DASH,
    readouts,
    statusText: statusText ?? '',
    a11ySummary: hudA11ySummary(vehicle, labels),
  };
}
