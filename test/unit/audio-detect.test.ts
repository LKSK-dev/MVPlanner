/** Unit tests for pure T8.7 audio alert detection. */
import { describe, expect, it } from 'vitest';
import type { VehicleState } from '../../src/contracts';
import { detectAlerts } from '../../src/core/audio';

function vehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    sysid: 1,
    compid: 1,
    mavType: 2,
    autopilot: 3,
    vehicleClass: 'copter',
    armed: false,
    mode: 'STABILIZE',
    attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
    battery: { voltageV: 12, remainingPct: 80 },
    gps: { fix: 3, sats: 10, hdop: 0.8 },
    ekfOk: true,
    link: { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 1, signed: false },
    lastHeartbeatMs: 1_000,
    ...overrides,
  };
}

describe('detectAlerts', () => {
  it('detects mode changes', () => {
    const alerts = detectAlerts(vehicle({ mode: 'LOITER' }), vehicle({ mode: 'RTL' }), {
      nowMs: 10,
    });
    expect(alerts.map((a) => a.kind)).toEqual(['mode-change']);
    expect(alerts[0]?.messageKey).toBe('audio.alert.modeChange');
    expect(alerts[0]?.vars).toEqual({ mode: 'RTL' });
  });

  it('detects arm and disarm transitions', () => {
    const armed = detectAlerts(vehicle({ armed: false }), vehicle({ armed: true }), { nowMs: 10 });
    const disarmed = detectAlerts(vehicle({ armed: true }), vehicle({ armed: false }), {
      nowMs: 20,
    });
    expect(armed.map((a) => a.kind)).toEqual(['armed']);
    expect(disarmed.map((a) => a.kind)).toEqual(['disarmed']);
  });

  it('detects low-battery threshold crossings once per transition', () => {
    const alerts = detectAlerts(
      vehicle({ battery: { voltageV: 12.2, remainingPct: 25 } }),
      vehicle({ battery: { voltageV: 11.4, remainingPct: 20 } }),
      { nowMs: 10 },
    );
    expect(alerts.map((a) => a.kind)).toEqual(['battery-low']);
    expect(alerts[0]?.vars).toEqual({ pct: 20 });

    const steadyLow = detectAlerts(
      vehicle({ battery: { voltageV: 11.4, remainingPct: 19 } }),
      vehicle({ battery: { voltageV: 11.3, remainingPct: 18 } }),
      { nowMs: 20 },
    );
    expect(steadyLow).toEqual([]);
  });

  it('prefers critical battery when both low and critical thresholds are crossed', () => {
    const alerts = detectAlerts(
      vehicle({ battery: { voltageV: 12.2, remainingPct: 30 } }),
      vehicle({ battery: { voltageV: 10.4, remainingPct: 9 } }),
      { nowMs: 10 },
    );
    expect(alerts.map((a) => a.kind)).toEqual(['battery-critical']);
  });

  it('detects GPS fix loss', () => {
    const alerts = detectAlerts(
      vehicle({ gps: { fix: 3, sats: 9, hdop: 0.9 } }),
      vehicle({ gps: { fix: 1, sats: 5, hdop: 2.5 } }),
      { nowMs: 10 },
    );
    expect(alerts.map((a) => a.kind)).toEqual(['gps-lost']);
  });

  it('detects EKF unhealthy transitions', () => {
    const alerts = detectAlerts(vehicle({ ekfOk: true }), vehicle({ ekfOk: false }), { nowMs: 10 });
    expect(alerts.map((a) => a.kind)).toEqual(['ekf-unhealthy']);
  });

  it('classifies warning-or-worse failsafe STATUSTEXT events', () => {
    const alerts = detectAlerts(vehicle(), vehicle(), {
      nowMs: 10,
      statusText: { severity: 4, text: 'Radio failsafe triggered' },
    });
    expect(alerts.map((a) => a.kind)).toEqual(['failsafe-rc']);
    expect(alerts[0]?.category).toBe('failsafe');
  });

  it('dedupes and rate-limits alerts by key', () => {
    const prev = vehicle({ mode: 'LOITER' });
    const next = vehicle({ mode: 'RTL' });
    const first = detectAlerts(prev, next, { nowMs: 10 });
    const key = first[0]?.key;
    expect(key).toBeDefined();
    if (key === undefined) throw new Error('expected mode alert key');

    const limited = detectAlerts(prev, next, { nowMs: 1_000, lastFiredMs: new Map([[key, 10]]) });
    expect(limited).toEqual([]);

    const allowed = detectAlerts(prev, next, { nowMs: 10_000, lastFiredMs: new Map([[key, 10]]) });
    expect(allowed.map((a) => a.kind)).toEqual(['mode-change']);
  });
});
