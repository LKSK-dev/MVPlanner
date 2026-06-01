/**
 * Pure ESC-calibration + motor-test command mapping for the Setup motors step
 * (T5.10; spec plan/04 §4.4 ESC/motor, plan/08 §8.2/§8.3 destructive gating).
 *
 * This module deliberately contains NO Solid UI and NO MAVLink side effects: it
 * only maps motor-test intents to the `MAV_CMD_DO_MOTOR_TEST` (209) parameter
 * vector and exposes the small constant tables the step uses. That keeps the
 * safety-critical wire mapping trivially unit-testable in isolation, and keeps
 * the spinning-propeller hazard logic (gating) entirely in the component.
 */
import type { VehicleClass } from '../../../../contracts';

/**
 * `MAV_CMD_DO_MOTOR_TEST` (209) — spin a single motor (or an ordered range) at a
 * commanded throttle for a bounded timeout. A protocol constant; never changes.
 */
export const MAV_CMD_DO_MOTOR_TEST = 209;

/**
 * `MOTOR_TEST_THROTTLE_TYPE` values (param2). MVPlanner always commands by
 * PERCENT so a low default throttle is firmware-agnostic.
 */
export const MOTOR_TEST_THROTTLE_PERCENT = 0;
/** `MOTOR_TEST_THROTTLE_PWM` — raw PWM µs (unused by this UI; documented). */
export const MOTOR_TEST_THROTTLE_PWM = 1;
/** `MOTOR_TEST_THROTTLE_PILOT` — pilot's current throttle (unused). */
export const MOTOR_TEST_THROTTLE_PILOT = 2;

/** `MOTOR_TEST_ORDER` values (param6). */
export const MOTOR_TEST_ORDER_DEFAULT = 0;
/** Test in numeric motor-output order. */
export const MOTOR_TEST_ORDER_SEQUENCE = 1;
/** Test in physical board order. */
export const MOTOR_TEST_ORDER_BOARD = 2;

/** A deliberately LOW default test throttle (percent) — spinning-prop hazard. */
export const DEFAULT_MOTOR_TEST_THROTTLE_PCT = 5;
/** A deliberately SHORT default per-motor timeout (seconds). */
export const DEFAULT_MOTOR_TEST_TIMEOUT_S = 2;
/** Hard ceiling on the throttle the UI will ever command (safety clamp). */
export const MAX_MOTOR_TEST_THROTTLE_PCT = 25;
/** Hard ceiling on the per-motor timeout the UI will ever command. */
export const MAX_MOTOR_TEST_TIMEOUT_S = 10;
/** Largest motor count the UI exposes (covers dodeca-hexa airframes). */
export const MAX_MOTOR_COUNT = 12;

/**
 * ArduPilot parameter that arms the all-at-once ESC calibration sequence. Set to
 * {@link ESC_CALIBRATION_ENABLE} and reboot (with throttle high / battery) to
 * enter calibration on the next boot; reset to {@link ESC_CALIBRATION_NORMAL}
 * afterwards. Written only behind an explicit confirmation.
 */
export const ESC_CALIBRATION_PARAM = 'ESC_CALIBRATION';
/** `ESC_CALIBRATION = 0` — normal start-up (no calibration). */
export const ESC_CALIBRATION_NORMAL = 0;
/** `ESC_CALIBRATION = 3` — enter ESC calibration on the next boot. */
export const ESC_CALIBRATION_ENABLE = 3;

/** An intent to spin one motor instance at a throttle for a bounded timeout. */
export interface MotorTestRequest {
  /** 1-based motor instance to spin. */
  readonly instance: number;
  /** Commanded throttle, percent. */
  readonly throttlePct: number;
  /** Per-motor spin timeout, seconds. */
  readonly timeoutS: number;
  /** Throttle type (param2); defaults to {@link MOTOR_TEST_THROTTLE_PERCENT}. */
  readonly throttleType?: number;
  /** Motor count (param5) — `0` for a single motor; N for a sequence. */
  readonly motorCount?: number;
  /** Test order (param6); defaults to {@link MOTOR_TEST_ORDER_DEFAULT}. */
  readonly testOrder?: number;
}

/** Clamp a value to `[min, max]`, returning `min` for non-finite input. */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Clamp a requested throttle to the safe `[0, MAX]` percent range. */
export function clampThrottlePct(pct: number): number {
  return clamp(pct, 0, MAX_MOTOR_TEST_THROTTLE_PCT);
}

/** Clamp a requested timeout to the safe `[0, MAX]` seconds range. */
export function clampTimeoutS(seconds: number): number {
  return clamp(seconds, 0, MAX_MOTOR_TEST_TIMEOUT_S);
}

/** Clamp a requested motor count to the supported `[1, MAX]` range. */
export function clampMotorCount(count: number): number {
  return Math.round(clamp(count, 1, MAX_MOTOR_COUNT));
}

/**
 * Map a {@link MotorTestRequest} to the 7-slot `MAV_CMD_DO_MOTOR_TEST` (209)
 * parameter vector consumed by `CommandClient.send`:
 *
 * - `param1` = motor instance (1-based)
 * - `param2` = throttle type (`0` = percent)
 * - `param3` = throttle value (percent)
 * - `param4` = timeout (seconds)
 * - `param5` = motor count (`0` = single motor)
 * - `param6` = test order
 * - `param7` = unused (`0`)
 *
 * The throttle is clamped to {@link MAX_MOTOR_TEST_THROTTLE_PCT} and the timeout
 * to {@link MAX_MOTOR_TEST_TIMEOUT_S} as a defence-in-depth safety clamp.
 */
export function motorTestCommandParams(req: MotorTestRequest): number[] {
  return [
    Math.round(req.instance),
    req.throttleType ?? MOTOR_TEST_THROTTLE_PERCENT,
    clampThrottlePct(req.throttlePct),
    clampTimeoutS(req.timeoutS),
    req.motorCount ?? 0,
    req.testOrder ?? MOTOR_TEST_ORDER_DEFAULT,
    0,
  ];
}

/**
 * Map an emergency STOP for one motor instance to a `MAV_CMD_DO_MOTOR_TEST`
 * vector with zero throttle and zero timeout — the firmware halts the motor
 * immediately. Used by the step's Emergency-stop control (no confirmation).
 */
export function motorTestStopParams(instance: number): number[] {
  return motorTestCommandParams({ instance, throttlePct: 0, timeoutS: 0 });
}

/**
 * Lift-motor count for an ArduPilot `FRAME_CLASS` / QuadPlane `Q_FRAME_CLASS`
 * geometry. Only the geometries with an unambiguous motor count are listed;
 * anything else (e.g. `Undefined`, `Tailsitter`) is left to the per-class
 * default. Source: ArduCopter `FRAME_CLASS` / ArduPlane `Q_FRAME_CLASS`.
 */
const FRAME_CLASS_MOTOR_COUNT: Readonly<Record<number, number>> = {
  1: 4, // Quad
  2: 6, // Hexa
  3: 8, // Octa
  4: 8, // OctaQuad
  5: 6, // Y6
  7: 3, // Tri
  12: 12, // DodecaHexa
  14: 10, // Deca
};

/**
 * A sensible default motor count for a vehicle, used to seed the count input.
 * The user can adjust within `[1, MAX_MOTOR_COUNT]`; this is only a hint.
 *
 * When a `frameClass` (ArduCopter `FRAME_CLASS` / ArduPlane `Q_FRAME_CLASS`) is
 * known it is preferred and the count is derived from the geometry. Otherwise a
 * per-class heuristic applies: copter `4`, sub `6`, and — since a `plane` that
 * reaches the motor-test step almost always has VTOL lift motors (`Q_ENABLE`
 * on) — a QuadPlane seeds the common quad layout (`4`); a pure fixed-wing user
 * adjusts down to `1`. All other classes seed `1`.
 */
export function defaultMotorCount(vehicleClass: VehicleClass, frameClass?: number): number {
  if (frameClass !== undefined) {
    const derived = FRAME_CLASS_MOTOR_COUNT[frameClass];
    if (derived !== undefined) return derived;
  }
  switch (vehicleClass) {
    case 'copter':
      return 4;
    case 'sub':
      return 6;
    case 'plane':
      return 4;
    case 'rover':
    case 'boat':
    case 'tracker':
    case 'unknown':
      return 1;
  }
}

/** The ordered list of 1-based motor instances for a given count. */
export function motorInstances(count: number): number[] {
  const safe = clampMotorCount(count);
  const result: number[] = [];
  for (let i = 1; i <= safe; i += 1) result.push(i);
  return result;
}
