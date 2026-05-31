/**
 * Pure value/format logic for the gauges (task T2.2; spec plan/04 §4.2).
 *
 * Every helper turns raw telemetry into locale-formatted {@link GaugeReading}s
 * (or canvas text values) and is free of DOM and i18n copy: labels/units/enum
 * values are returned as i18n KEYS resolved by the widgets. This keeps the
 * value logic unit-testable without a browser.
 */
import { formatDecimal, formatInteger } from '../../../core/i18n';
import type { VehicleState } from '../../../contracts';
import { normalizeHeadingDeg, radToDeg } from './geometry';
import type { GaugeReading, GaugeStatus, LabelVars, NavProgress, RcState } from './types';
import type { UnitHook } from './units';

/* ------------------------------------------------------------------ helpers */

interface ReadingOpts {
  labelVars?: LabelVars;
  unitKey?: string;
  status?: GaugeStatus;
}

/** Build a reading whose value is a pre-formatted literal (or none when absent). */
function reading(
  labelKey: string,
  value: string | undefined,
  opts: ReadingOpts = {},
): GaugeReading {
  const r: GaugeReading = { labelKey };
  if (value !== undefined) r.value = value;
  if (opts.labelVars !== undefined) r.labelVars = opts.labelVars;
  if (opts.unitKey !== undefined) r.unitKey = opts.unitKey;
  if (opts.status !== undefined) r.status = opts.status;
  return r;
}

/** Build a reading whose value is an i18n key (enum-like value). */
function readingKey(labelKey: string, valueKey: string, status?: GaugeStatus): GaugeReading {
  const r: GaugeReading = { labelKey, valueKey };
  if (status !== undefined) r.status = status;
  return r;
}

/* ----------------------------------------------------------- canvas text fns */

/** Whole-degree string for an angle in radians (no unit symbol). */
export function formatDegrees(rad: number): string {
  return formatInteger(radToDeg(rad));
}

/** `[0, 360)` heading string (whole degrees) for a yaw angle in radians. */
export function formatHeadingDeg(yawRad: number): string {
  return formatInteger(normalizeHeadingDeg(yawRad));
}

/** 8-point cardinal i18n key for a yaw angle in radians. */
export function cardinalKey(yawRad: number): string {
  const idx = Math.round(normalizeHeadingDeg(yawRad) / 45) % 8;
  const keys = [
    'gauges.compass.n',
    'gauges.compass.ne',
    'gauges.compass.e',
    'gauges.compass.se',
    'gauges.compass.s',
    'gauges.compass.sw',
    'gauges.compass.w',
    'gauges.compass.nw',
  ] as const;
  return keys[idx] ?? 'gauges.compass.n';
}

/** `m:ss` clock-style duration from seconds (negative/non-finite → none). */
export function formatDuration(totalS: number): string | undefined {
  if (!Number.isFinite(totalS) || totalS < 0) return undefined;
  const s = Math.round(totalS);
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${formatInteger(minutes)}:${seconds.toString().padStart(2, '0')}`;
}

/* ------------------------------------------------------------- card readings */

/** Airspeed / groundspeed readings (airspeed only when present). */
export function airspeedReadings(v: VehicleState | undefined, units: UnitHook): GaugeReading[] {
  const vel = v?.velocity;
  const ground = units.speed(vel?.groundMs ?? 0);
  const rows: GaugeReading[] = [
    reading('gauges.groundspeed', vel ? ground.value : undefined, { unitKey: ground.unitKey }),
  ];
  if (vel?.airMs !== undefined) {
    const air = units.speed(vel.airMs);
    rows.push(reading('gauges.airspeed', air.value, { unitKey: air.unitKey }));
  }
  return rows;
}

/** Battery readings: voltage, current (when present), remaining %. */
export function batteryReadings(v: VehicleState | undefined): GaugeReading[] {
  const b = v?.battery;
  const rows: GaugeReading[] = [
    reading('gauges.voltage', b ? formatDecimal(b.voltageV, 1) : undefined, {
      unitKey: 'gauges.unit.v',
    }),
  ];
  if (b?.currentA !== undefined) {
    rows.push(
      reading('gauges.current', formatDecimal(b.currentA, 1), { unitKey: 'gauges.unit.a' }),
    );
  }
  const pct = b?.remainingPct;
  rows.push(
    reading('gauges.remaining', pct !== undefined ? formatInteger(pct) : undefined, {
      unitKey: 'gauges.unit.pct',
      status: batteryStatus(pct),
    }),
  );
  return rows;
}

function batteryStatus(pct: number | undefined): GaugeStatus {
  if (pct === undefined) return 'neutral';
  if (pct < 10) return 'error';
  if (pct < 20) return 'warn';
  return 'ok';
}

/** GPS readings: fix type (decoded), satellites, HDOP. */
export function gpsReadings(v: VehicleState | undefined): GaugeReading[] {
  const g = v?.gps;
  return [
    g
      ? readingKey('gauges.fix', gpsFixKey(g.fix), gpsFixStatus(g.fix))
      : reading('gauges.fix', undefined),
    reading('gauges.sats', g ? formatInteger(g.sats) : undefined),
    reading('gauges.hdop', g ? formatDecimal(g.hdop, 2) : undefined),
  ];
}

const GPS_FIX_KEYS: Readonly<Record<number, string>> = {
  0: 'gauges.gps.fix.none',
  1: 'gauges.gps.fix.none',
  2: 'gauges.gps.fix.2d',
  3: 'gauges.gps.fix.3d',
  4: 'gauges.gps.fix.dgps',
  5: 'gauges.gps.fix.rtkFloat',
  6: 'gauges.gps.fix.rtkFixed',
};

/** i18n key for a `GPS_FIX_TYPE` value (defaults to "no fix"). */
export function gpsFixKey(fix: number): string {
  return GPS_FIX_KEYS[fix] ?? 'gauges.gps.fix.none';
}

function gpsFixStatus(fix: number): GaugeStatus {
  if (fix >= 3) return 'ok';
  if (fix === 2) return 'warn';
  return 'error';
}

/** EKF status reading (ok / bad / unknown). */
export function ekfReadings(v: VehicleState | undefined): GaugeReading[] {
  const ok = v?.ekfOk;
  if (ok === undefined) return [reading('gauges.ekf.status', undefined)];
  return [
    readingKey(
      'gauges.ekf.status',
      ok ? 'gauges.value.ok' : 'gauges.value.bad',
      ok ? 'ok' : 'error',
    ),
  ];
}

/** Vibration readings (x/y/z, thresholded warn/error). */
export function vibeReadings(v: VehicleState | undefined): GaugeReading[] {
  const vibe = v?.vibe;
  const axis = (labelKey: string, value: number | undefined): GaugeReading =>
    reading(labelKey, value !== undefined ? formatDecimal(value, 1) : undefined, {
      status: vibeStatus(value),
    });
  return [
    axis('gauges.vibe.x', vibe?.x),
    axis('gauges.vibe.y', vibe?.y),
    axis('gauges.vibe.z', vibe?.z),
  ];
}

/** Vibration warn at 30 m/s², error at 60 m/s² (ArduPilot guidance). */
const VIBE_WARN = 30;
const VIBE_ERROR = 60;

function vibeStatus(value: number | undefined): GaugeStatus {
  if (value === undefined) return 'neutral';
  if (value >= VIBE_ERROR) return 'error';
  if (value >= VIBE_WARN) return 'warn';
  return 'ok';
}

/** RC input/output channel readings (per channel, microseconds). */
export function rcReadings(rc: RcState | undefined): GaugeReading[] {
  if (rc === undefined || (rc.inputs.length === 0 && rc.outputs.length === 0)) {
    return [reading('gauges.rc.none', undefined)];
  }
  const rows: GaugeReading[] = [];
  rc.inputs.forEach((us, i) => {
    rows.push(
      reading('gauges.rc.in.ch', formatInteger(us), {
        labelVars: { n: i + 1 },
        unitKey: 'gauges.unit.us',
      }),
    );
  });
  rc.outputs.forEach((us, i) => {
    rows.push(
      reading('gauges.rc.out.ch', formatInteger(us), {
        labelVars: { n: i + 1 },
        unitKey: 'gauges.unit.us',
      }),
    );
  });
  return rows;
}

/** System status readings: armed state + flight mode. */
export function systemReadings(v: VehicleState | undefined): GaugeReading[] {
  if (v === undefined) {
    return [reading('gauges.system.armed', undefined), reading('gauges.system.mode', undefined)];
  }
  return [
    readingKey(
      'gauges.system.armed',
      v.armed ? 'gauges.system.armedYes' : 'gauges.system.armedNo',
      v.armed ? 'warn' : 'ok',
    ),
    reading('gauges.system.mode', v.mode),
  ];
}

/** Link / RSSI readings derived from {@link LinkStats}. */
export function linkReadings(link: VehicleState['link'] | undefined): GaugeReading[] {
  if (link === undefined) {
    return [reading('gauges.link.rate', undefined), reading('gauges.link.loss', undefined)];
  }
  const rows: GaugeReading[] = [
    reading('gauges.link.rate', formatDecimal(link.rateHz, 1), { unitKey: 'gauges.unit.hz' }),
    reading('gauges.link.loss', formatDecimal(link.lossPct, 1), {
      unitKey: 'gauges.unit.pct',
      status: lossStatus(link.lossPct),
    }),
  ];
  if (link.rssi !== undefined) {
    rows.push(reading('gauges.link.rssi', formatInteger(link.rssi)));
  }
  rows.push(readingKey('gauges.link.signed', link.signed ? 'gauges.value.yes' : 'gauges.value.no'));
  return rows;
}

function lossStatus(lossPct: number): GaugeStatus {
  if (lossPct >= 20) return 'error';
  if (lossPct >= 5) return 'warn';
  return 'ok';
}

/** Current-WP / distance / ETA readings from active-mission progress. */
export function navReadings(nav: NavProgress | undefined, units: UnitHook): GaugeReading[] {
  if (nav === undefined) {
    return [
      reading('gauges.nav.wp', undefined),
      reading('gauges.nav.distance', undefined),
      reading('gauges.nav.eta', undefined),
    ];
  }
  const wp =
    nav.totalWp !== undefined
      ? `${formatInteger(nav.currentWp)} / ${formatInteger(nav.totalWp)}`
      : formatInteger(nav.currentWp);
  const dist = nav.distanceM !== undefined ? units.distance(nav.distanceM) : undefined;
  return [
    reading('gauges.nav.wp', wp),
    reading('gauges.nav.distance', dist?.value, dist ? { unitKey: dist.unitKey } : {}),
    reading('gauges.nav.eta', nav.etaS !== undefined ? formatDuration(nav.etaS) : undefined),
  ];
}
