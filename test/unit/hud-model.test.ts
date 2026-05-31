/**
 * HUD pure model tests (task T2.1; spec plan/04 §4.2, plan/05 §5.8).
 *
 * Exercises the geometry, value formatting, model assembly, screen-reader
 * summary and the redraw change-key — all side-effect-free, no DOM.
 */
import { describe, it, expect } from 'vitest';
import type { VehicleState } from '../../src/contracts';
import {
  DEFAULT_HUD_LABELS,
  HUD_DASH,
  buildHudModel,
  degToRad,
  fmtBattery,
  fmtClimb,
  fmtClock,
  fmtEkf,
  fmtGps,
  fmtHeading,
  fmtMeters,
  fmtSpeed,
  fmtThrottle,
  fmtVibe,
  gpsFixLabel,
  headingTapeTicks,
  hudA11ySummary,
  hudSignature,
  pitchLadderRungs,
  pitchPixels,
  radToDeg,
  wrapDeg180,
  wrapDeg360,
} from '../../src/ui/widgets/hud';

function makeVehicle(over: Partial<VehicleState> = {}): VehicleState {
  return {
    sysid: 1,
    compid: 1,
    mavType: 2,
    autopilot: 3,
    vehicleClass: 'copter',
    armed: true,
    mode: 'AUTO',
    attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
    position: { lat: 0, lon: 0, altRelM: 12.34, altAmslM: 112.34 },
    velocity: { groundMs: 5.4, airMs: 6.1, climbMs: 1.2 },
    battery: { voltageV: 16.2, remainingPct: 78 },
    gps: { fix: 3, sats: 12, hdop: 0.9 },
    ekfOk: true,
    vibe: { x: 8, y: 12.4, z: 3 },
    link: {
      rateHz: 50,
      lossPct: 0,
      bytesIn: 0,
      bytesOut: 0,
      packetsIn: 0,
      signed: false,
    },
    lastHeartbeatMs: 0,
    ...over,
  };
}

describe('HUD geometry', () => {
  it('converts radians and degrees round-trip', () => {
    expect(radToDeg(Math.PI)).toBeCloseTo(180);
    expect(degToRad(180)).toBeCloseTo(Math.PI);
    expect(radToDeg(degToRad(42))).toBeCloseTo(42);
  });

  it('wraps headings to [0, 360)', () => {
    expect(wrapDeg360(0)).toBe(0);
    expect(wrapDeg360(360)).toBe(0);
    expect(wrapDeg360(450)).toBe(90);
    expect(wrapDeg360(-90)).toBe(270);
  });

  it('wraps to shortest signed range (-180, 180]', () => {
    expect(wrapDeg180(0)).toBe(0);
    expect(wrapDeg180(190)).toBe(-170);
    expect(wrapDeg180(-190)).toBe(170);
    expect(wrapDeg180(180)).toBe(180);
  });

  it('maps pitch to a downward pixel offset', () => {
    // +10° pitch with 5 px/deg → +50 px (horizon moves down).
    expect(pitchPixels(degToRad(10), 5)).toBeCloseTo(50);
    expect(pitchPixels(degToRad(-10), 5)).toBeCloseTo(-50);
  });

  it('builds pitch-ladder rungs excluding the horizon, descending', () => {
    const rungs = pitchLadderRungs(0, 25, 10);
    expect(rungs.map((r) => r.deg)).toEqual([20, 10, -10, -20]);
    expect(rungs.map((r) => r.label)).toEqual([20, 10, 10, 20]);
  });

  it('builds heading-tape ticks with signed deltas and major flags', () => {
    const ticks = headingTapeTicks(90, 20, 10);
    expect(ticks.map((t) => t.deg)).toEqual([70, 80, 90, 100, 110]);
    expect(ticks.map((t) => t.deltaDeg)).toEqual([-20, -10, 0, 10, 20]);
    // 90 and 120-range majors are multiples of 30.
    expect(ticks.find((t) => t.deg === 90)?.major).toBe(true);
    expect(ticks.find((t) => t.deg === 80)?.major).toBe(false);
  });

  it('wraps heading-tape tick bearings across north', () => {
    const ticks = headingTapeTicks(0, 20, 10);
    expect(ticks.map((t) => t.deg)).toEqual([340, 350, 0, 10, 20]);
    expect(ticks.map((t) => t.deltaDeg)).toEqual([-20, -10, 0, 10, 20]);
  });
});

describe('HUD value formatting', () => {
  it('formats distances and speeds, with a dash when missing', () => {
    expect(fmtMeters(12.34)).toBe('12.3 m');
    expect(fmtMeters(undefined)).toBe(HUD_DASH);
    expect(fmtSpeed(5.44)).toBe('5.4 m/s');
    expect(fmtSpeed(undefined)).toBe(HUD_DASH);
  });

  it('formats climb with an explicit sign', () => {
    expect(fmtClimb(1.2)).toBe('+1.2 m/s');
    expect(fmtClimb(-0.5)).toBe('-0.5 m/s');
    expect(fmtClimb(undefined)).toBe(HUD_DASH);
  });

  it('formats throttle, battery, gps, ekf and vibe', () => {
    expect(fmtThrottle(undefined)).toBe(HUD_DASH);
    expect(fmtThrottle(63.6)).toBe('64%');
    expect(fmtBattery(16.2, 78)).toBe('16.2 V \u00b7 78%');
    expect(fmtBattery(undefined, undefined)).toBe(HUD_DASH);
    expect(fmtBattery(16.2, undefined)).toBe('16.2 V');
    expect(gpsFixLabel(3)).toBe('3D');
    expect(gpsFixLabel(6)).toBe('RTK FIXED');
    expect(fmtGps(3, 12)).toBe('3D \u00b7 12');
    expect(fmtGps(undefined, undefined)).toBe(HUD_DASH);
    expect(fmtEkf(true)).toBe('OK');
    expect(fmtEkf(false)).toBe('BAD');
    expect(fmtEkf(undefined)).toBe(HUD_DASH);
    expect(fmtVibe({ x: 8, y: 12.4, z: 3 })).toBe('12');
    expect(fmtVibe(undefined)).toBe(HUD_DASH);
  });

  it('formats heading zero-padded with a degree sign', () => {
    expect(fmtHeading(5)).toBe('005\u00b0');
    expect(fmtHeading(359.6)).toBe('000\u00b0');
    expect(fmtHeading(-90)).toBe('270\u00b0');
  });

  it('formats a 24h clock from epoch ms', () => {
    const at = new Date(2026, 4, 31, 13, 45, 9).getTime();
    expect(fmtClock(at)).toBe('13:45:09');
  });
});

describe('buildHudModel', () => {
  it('maps a vehicle into a render-ready frame', () => {
    const m = buildHudModel(
      makeVehicle({ attitude: { rollRad: 0.1, pitchRad: 0.2, yawRad: degToRad(90) } }),
      'GPS Glitch',
      0,
    );
    expect(m.hasVehicle).toBe(true);
    expect(m.armed).toBe(true);
    expect(m.mode).toBe('AUTO');
    expect(m.headingDeg).toBeCloseTo(90);
    expect(m.readouts.airspeed).toBe('6.1 m/s');
    expect(m.readouts.altRel).toBe('12.3 m');
    expect(m.readouts.altAmsl).toBe('112.3 m');
    expect(m.readouts.climb).toBe('+1.2 m/s');
    expect(m.readouts.battery).toBe('16.2 V \u00b7 78%');
    expect(m.readouts.gps).toBe('3D \u00b7 12');
    expect(m.readouts.throttle).toBe(HUD_DASH); // not in the contract
    expect(m.statusText).toBe('GPS Glitch');
  });

  it('produces an empty frame when no vehicle is bound', () => {
    const m = buildHudModel(undefined, undefined, 0);
    expect(m.hasVehicle).toBe(false);
    expect(m.mode).toBe(HUD_DASH);
    expect(m.statusText).toBe('');
    expect(m.a11ySummary).toBe(DEFAULT_HUD_LABELS.noVehicle);
  });
});

describe('hudA11ySummary', () => {
  it('summarises mode/armed/altitude/speed/battery', () => {
    const s = hudA11ySummary(makeVehicle());
    expect(s).toContain('Mode AUTO');
    expect(s).toContain('ARMED');
    expect(s).toContain('altitude 12.3 m');
    expect(s).toContain('speed 6.1 m/s'); // prefers airspeed
    expect(s).toContain('battery 16.2 V \u00b7 78%');
  });

  it('falls back to groundspeed and reports disarmed', () => {
    const s = hudA11ySummary(
      makeVehicle({ armed: false, velocity: { groundMs: 2.5, climbMs: 0 } }),
    );
    expect(s).toContain('DISARMED');
    expect(s).toContain('speed 2.5 m/s');
  });

  it('reports no vehicle data when undefined', () => {
    expect(hudA11ySummary(undefined)).toBe(DEFAULT_HUD_LABELS.noVehicle);
  });
});

describe('hudSignature', () => {
  it('is stable for unchanged quantised inputs', () => {
    const v = makeVehicle();
    expect(hudSignature(v, 'x', 10)).toBe(hudSignature(makeVehicle(), 'x', 10));
  });

  it('changes when telemetry, status or the second changes', () => {
    const v = makeVehicle();
    const base = hudSignature(v, 'x', 10);
    expect(hudSignature(makeVehicle({ armed: false }), 'x', 10)).not.toBe(base);
    expect(hudSignature(v, 'y', 10)).not.toBe(base);
    expect(hudSignature(v, 'x', 11)).not.toBe(base);
    expect(
      hudSignature(
        makeVehicle({ position: { lat: 0, lon: 0, altRelM: 99, altAmslM: 112.34 } }),
        'x',
        10,
      ),
    ).not.toBe(base);
  });

  it('handles an undefined vehicle', () => {
    expect(hudSignature(undefined, undefined, 3)).toBe('none||3');
  });
});
