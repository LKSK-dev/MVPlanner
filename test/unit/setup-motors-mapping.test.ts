/**
 * Pure motor-test command-mapping tests (T5.10). No Solid, no DOM — just the
 * `MAV_CMD_DO_MOTOR_TEST` (209) parameter mapping + safety clamps.
 */
import { describe, expect, it } from 'vitest';
import type { VehicleClass } from '../../src/contracts';
import {
  DEFAULT_MOTOR_TEST_THROTTLE_PCT,
  DEFAULT_MOTOR_TEST_TIMEOUT_S,
  MAV_CMD_DO_MOTOR_TEST,
  MAX_MOTOR_COUNT,
  MAX_MOTOR_TEST_THROTTLE_PCT,
  MAX_MOTOR_TEST_TIMEOUT_S,
  MOTOR_TEST_ORDER_DEFAULT,
  MOTOR_TEST_THROTTLE_PERCENT,
  clampMotorCount,
  clampThrottlePct,
  clampTimeoutS,
  defaultMotorCount,
  motorInstances,
  motorTestCommandParams,
  motorTestStopParams,
} from '../../src/ui/screens/setup/motors';

describe('motor-test mapping', () => {
  it('uses the protocol command id 209', () => {
    expect(MAV_CMD_DO_MOTOR_TEST).toBe(209);
  });

  it('maps a request to the 7-slot DO_MOTOR_TEST vector (percent throttle)', () => {
    const params = motorTestCommandParams({ instance: 3, throttlePct: 7, timeoutS: 2 });
    expect(params).toEqual([3, MOTOR_TEST_THROTTLE_PERCENT, 7, 2, 0, MOTOR_TEST_ORDER_DEFAULT, 0]);
  });

  it('keeps default throttle/timeout low and short', () => {
    expect(DEFAULT_MOTOR_TEST_THROTTLE_PCT).toBeLessThanOrEqual(10);
    expect(DEFAULT_MOTOR_TEST_TIMEOUT_S).toBeLessThanOrEqual(5);
    const params = motorTestCommandParams({
      instance: 1,
      throttlePct: DEFAULT_MOTOR_TEST_THROTTLE_PCT,
      timeoutS: DEFAULT_MOTOR_TEST_TIMEOUT_S,
    });
    expect(params[2]).toBe(DEFAULT_MOTOR_TEST_THROTTLE_PCT);
    expect(params[3]).toBe(DEFAULT_MOTOR_TEST_TIMEOUT_S);
  });

  it('clamps throttle and timeout to safe ceilings', () => {
    expect(clampThrottlePct(999)).toBe(MAX_MOTOR_TEST_THROTTLE_PCT);
    expect(clampThrottlePct(-5)).toBe(0);
    expect(clampTimeoutS(999)).toBe(MAX_MOTOR_TEST_TIMEOUT_S);
    expect(clampTimeoutS(-1)).toBe(0);

    const params = motorTestCommandParams({ instance: 1, throttlePct: 80, timeoutS: 60 });
    expect(params[2]).toBe(MAX_MOTOR_TEST_THROTTLE_PCT);
    expect(params[3]).toBe(MAX_MOTOR_TEST_TIMEOUT_S);
  });

  it('clamps motor count to [1, MAX]', () => {
    expect(clampMotorCount(0)).toBe(1);
    expect(clampMotorCount(99)).toBe(MAX_MOTOR_COUNT);
    expect(clampMotorCount(3.6)).toBe(4);
  });

  it('builds an immediate stop vector (zero throttle, zero timeout)', () => {
    const params = motorTestStopParams(2);
    expect(params).toEqual([2, MOTOR_TEST_THROTTLE_PERCENT, 0, 0, 0, MOTOR_TEST_ORDER_DEFAULT, 0]);
  });

  it('enumerates 1-based motor instances', () => {
    expect(motorInstances(4)).toEqual([1, 2, 3, 4]);
    expect(motorInstances(0)).toEqual([1]);
  });

  it('seeds a sensible default motor count per vehicle class', () => {
    const cases: ReadonlyArray<readonly [VehicleClass, number]> = [
      ['copter', 4],
      ['sub', 6],
      ['rover', 1],
      // A plane reaching the motor-test step is a QuadPlane (VTOL lift motors).
      ['plane', 4],
    ];
    for (const [cls, expected] of cases) {
      expect(defaultMotorCount(cls)).toBe(expected);
    }
  });

  it('derives the count from a (Q_)FRAME_CLASS geometry when known', () => {
    expect(defaultMotorCount('plane', 1)).toBe(4); // QuadPlane Quad
    expect(defaultMotorCount('plane', 2)).toBe(6); // Hexa
    expect(defaultMotorCount('plane', 3)).toBe(8); // Octa
    expect(defaultMotorCount('plane', 4)).toBe(8); // OctaQuad
    expect(defaultMotorCount('plane', 5)).toBe(6); // Y6
    expect(defaultMotorCount('plane', 7)).toBe(3); // Tri
    expect(defaultMotorCount('copter', 2)).toBe(6); // Hexa copter
    expect(defaultMotorCount('plane', 12)).toBe(12); // DodecaHexa
    expect(defaultMotorCount('plane', 14)).toBe(10); // Deca
    // Unmapped/undefined frame classes fall back to the per-class default.
    expect(defaultMotorCount('plane', 0)).toBe(4);
    expect(defaultMotorCount('rover', 0)).toBe(1);
  });
});
