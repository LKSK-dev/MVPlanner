/**
 * Pure value/format/geometry/registry tests for the gauges widget (task T2.2;
 * spec plan/04 §4.2). No DOM: exercises the testable core directly.
 */
import { describe, it, expect } from 'vitest';
import type { VehicleState } from '../../src/contracts';
import {
  // geometry
  attitudeGeometry,
  compassGeometry,
  vsiGeometry,
  normalizeHeadingDeg,
  clamp,
  radToDeg,
  ATTITUDE_PITCH_FOV_RAD,
  VSI_MAX_DEFAULT_MS,
  // units
  metricUnits,
  // format
  airspeedReadings,
  batteryReadings,
  gpsReadings,
  gpsFixKey,
  ekfReadings,
  vibeReadings,
  rcReadings,
  systemReadings,
  linkReadings,
  navReadings,
  formatDegrees,
  formatHeadingDeg,
  formatDuration,
  cardinalKey,
  // registry
  GAUGES,
  DEFAULT_GAUGE_SELECTION,
  getGauge,
  resolveSelection,
} from '../../src/ui/widgets/gauges';

function vehicle(over: Partial<VehicleState> = {}): VehicleState {
  return {
    sysid: 1,
    compid: 1,
    mavType: 2,
    autopilot: 3,
    vehicleClass: 'copter',
    armed: false,
    mode: 'STABILIZE',
    attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
    link: { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false },
    lastHeartbeatMs: 0,
    ...over,
  };
}

describe('geometry', () => {
  it('clamps and converts', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
  });

  it('attitude maps pitch to a full-radius offset and passes roll through', () => {
    const g = attitudeGeometry(0.5, 0, 100, 100);
    expect(g.cx).toBe(50);
    expect(g.radius).toBe(50);
    expect(g.rollRad).toBe(0.5);
    expect(g.pitchOffset).toBe(0);
    const up = attitudeGeometry(0, ATTITUDE_PITCH_FOV_RAD, 100, 100);
    expect(up.pitchOffset).toBeCloseTo(50);
    const clamped = attitudeGeometry(0, ATTITUDE_PITCH_FOV_RAD * 2, 100, 100);
    expect(clamped.pitchOffset).toBeCloseTo(50); // clamped to full scale
  });

  it('compass normalises heading to [0,360)', () => {
    expect(compassGeometry(Math.PI / 2, 80, 80).headingDeg).toBeCloseTo(90);
    expect(normalizeHeadingDeg(-Math.PI / 2)).toBeCloseTo(270);
    expect(normalizeHeadingDeg(0)).toBe(0);
  });

  it('vsi needle points up at zero climb and sweeps with sign', () => {
    const zero = vsiGeometry(0, 100, 100);
    expect(zero.needleRad).toBeCloseTo(-Math.PI / 2);
    const upMax = vsiGeometry(VSI_MAX_DEFAULT_MS, 100, 100);
    const downMax = vsiGeometry(-VSI_MAX_DEFAULT_MS, 100, 100);
    expect(upMax.needleRad).toBeGreaterThan(zero.needleRad);
    expect(downMax.needleRad).toBeLessThan(zero.needleRad);
    expect(vsiGeometry(99, 100, 100).climb).toBe(VSI_MAX_DEFAULT_MS); // clamped
  });
});

describe('units (metric default)', () => {
  it('formats speed/altitude/climb in metric', () => {
    expect(metricUnits.speed(12.34)).toEqual({ value: '12.3', unitKey: 'gauges.unit.ms' });
    expect(metricUnits.climb(-1.5)).toEqual({ value: '-1.5', unitKey: 'gauges.unit.ms' });
    expect(metricUnits.altitude(10)).toEqual({ value: '10.0', unitKey: 'gauges.unit.m' });
  });

  it('scales distance from m to km past 1000 m', () => {
    expect(metricUnits.distance(500)).toEqual({ value: '500', unitKey: 'gauges.unit.m' });
    expect(metricUnits.distance(1500)).toEqual({ value: '1.50', unitKey: 'gauges.unit.km' });
  });
});

describe('canvas text helpers', () => {
  it('formats degrees / heading / cardinal / duration', () => {
    expect(formatDegrees(Math.PI)).toBe('180');
    expect(formatHeadingDeg(-Math.PI / 2)).toBe('270');
    expect(cardinalKey(0)).toBe('gauges.compass.n');
    expect(cardinalKey(Math.PI / 2)).toBe('gauges.compass.e');
    expect(formatDuration(90)).toBe('1:30');
    expect(formatDuration(-1)).toBeUndefined();
  });
});

describe('card readings', () => {
  it('airspeed shows ground always and air only when present', () => {
    const noAir = airspeedReadings(vehicle({ velocity: { groundMs: 5, climbMs: 0 } }), metricUnits);
    expect(noAir).toHaveLength(1);
    expect(noAir[0]).toMatchObject({ labelKey: 'gauges.groundspeed', value: '5.0' });
    const withAir = airspeedReadings(
      vehicle({ velocity: { groundMs: 5, airMs: 6, climbMs: 0 } }),
      metricUnits,
    );
    expect(withAir.map((r) => r.labelKey)).toEqual(['gauges.groundspeed', 'gauges.airspeed']);
  });

  it('airspeed shows none when no velocity', () => {
    const r = airspeedReadings(vehicle(), metricUnits);
    expect(r[0]?.value).toBeUndefined();
  });

  it('battery thresholds remaining %', () => {
    const rows = batteryReadings(
      vehicle({ battery: { voltageV: 12.34, currentA: 5.5, remainingPct: 15 } }),
    );
    expect(rows[0]).toMatchObject({ labelKey: 'gauges.voltage', value: '12.3' });
    expect(rows[1]).toMatchObject({ labelKey: 'gauges.current', value: '5.5' });
    expect(rows[2]).toMatchObject({ labelKey: 'gauges.remaining', value: '15', status: 'warn' });
    const remaining = (pct: number): string | undefined =>
      batteryReadings(vehicle({ battery: { voltageV: 12, remainingPct: pct } })).find(
        (r) => r.labelKey === 'gauges.remaining',
      )?.status;
    expect(remaining(5)).toBe('error');
    expect(remaining(80)).toBe('ok');
  });

  it('gps decodes fix type and status', () => {
    expect(gpsFixKey(6)).toBe('gauges.gps.fix.rtkFixed');
    const ok = gpsReadings(vehicle({ gps: { fix: 3, sats: 12, hdop: 0.9 } }));
    expect(ok[0]).toMatchObject({ valueKey: 'gauges.gps.fix.3d', status: 'ok' });
    expect(ok[1]).toMatchObject({ labelKey: 'gauges.sats', value: '12' });
    expect(gpsReadings(vehicle({ gps: { fix: 2, sats: 5, hdop: 3 } }))[0]?.status).toBe('warn');
    expect(gpsReadings(vehicle({ gps: { fix: 0, sats: 0, hdop: 99 } }))[0]?.status).toBe('error');
  });

  it('ekf maps ok/bad/unknown', () => {
    expect(ekfReadings(vehicle({ ekfOk: true }))[0]).toMatchObject({
      valueKey: 'gauges.value.ok',
      status: 'ok',
    });
    expect(ekfReadings(vehicle({ ekfOk: false }))[0]?.status).toBe('error');
    expect(ekfReadings(vehicle())[0]?.value).toBeUndefined();
  });

  it('vibe thresholds each axis', () => {
    const rows = vibeReadings(vehicle({ vibe: { x: 5, y: 35, z: 65 } }));
    expect(rows.map((r) => r.status)).toEqual(['ok', 'warn', 'error']);
  });

  it('rc lists channels or an empty state', () => {
    expect(rcReadings(undefined)[0]?.labelKey).toBe('gauges.rc.none');
    const rows = rcReadings({ inputs: [1500, 1600], outputs: [1000] });
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      labelKey: 'gauges.rc.in.ch',
      labelVars: { n: 1 },
      value: '1,500',
    });
    expect(rows[2]).toMatchObject({ labelKey: 'gauges.rc.out.ch', labelVars: { n: 1 } });
  });

  it('system shows armed + mode', () => {
    const armed = systemReadings(vehicle({ armed: true, mode: 'AUTO' }));
    expect(armed[0]).toMatchObject({ valueKey: 'gauges.system.armedYes', status: 'warn' });
    expect(armed[1]).toMatchObject({ labelKey: 'gauges.system.mode', value: 'AUTO' });
    expect(systemReadings(vehicle({ armed: false }))[0]?.status).toBe('ok');
  });

  it('link reports rate/loss/rssi/signed with loss status', () => {
    const rows = linkReadings({
      bytesIn: 0,
      bytesOut: 0,
      packetsIn: 0,
      lossPct: 2,
      rateHz: 10,
      rssi: 70,
      signed: true,
    });
    expect(rows[0]).toMatchObject({ labelKey: 'gauges.link.rate', value: '10.0' });
    expect(rows[1]).toMatchObject({ labelKey: 'gauges.link.loss', status: 'ok' });
    expect(rows.find((r) => r.labelKey === 'gauges.link.rssi')).toMatchObject({ value: '70' });
    expect(rows.find((r) => r.labelKey === 'gauges.link.signed')).toMatchObject({
      valueKey: 'gauges.value.yes',
    });
    const lossy = linkReadings({
      bytesIn: 0,
      bytesOut: 0,
      packetsIn: 0,
      lossPct: 25,
      rateHz: 1,
      signed: false,
    });
    expect(lossy[1]?.status).toBe('error');
    expect(lossy.find((r) => r.labelKey === 'gauges.link.rssi')).toBeUndefined();
  });

  it('nav formats wp/distance/eta', () => {
    const rows = navReadings({ currentWp: 2, totalWp: 5, distanceM: 1500, etaS: 90 }, metricUnits);
    expect(rows[0]).toMatchObject({ labelKey: 'gauges.nav.wp', value: '2 / 5' });
    expect(rows[1]).toMatchObject({ value: '1.50', unitKey: 'gauges.unit.km' });
    expect(rows[2]).toMatchObject({ labelKey: 'gauges.nav.eta', value: '1:30' });
    expect(navReadings(undefined, metricUnits)[0]?.value).toBeUndefined();
    expect(navReadings({ currentWp: 1 }, metricUnits)[0]?.value).toBe('1');
  });
});

describe('registry + selection', () => {
  it('exposes all 12 gauges with stable ids', () => {
    expect(GAUGES).toHaveLength(12);
    expect(DEFAULT_GAUGE_SELECTION).toEqual(GAUGES.map((g) => g.id));
    expect(getGauge('attitude')?.kind).toBe('canvas');
    expect(getGauge('battery')?.kind).toBe('card');
    expect(getGauge('nope')).toBeUndefined();
  });

  it('resolves a selection in order, skipping unknown ids', () => {
    const sel = resolveSelection(['battery', 'nope', 'attitude']);
    expect(sel.map((d) => d.id)).toEqual(['battery', 'attitude']);
    expect(resolveSelection()).toHaveLength(12);
  });
});
