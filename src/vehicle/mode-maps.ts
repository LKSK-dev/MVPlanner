/**
 * Vehicle classification + flight-mode decode tables (task T1.5).
 *
 * Pure DATA module: `MAV_TYPE` → {@link VehicleClass} and per-class ArduPilot
 * `HEARTBEAT.custom_mode` → mode-name maps, plus a best-effort PX4 decode. Kept
 * separate from the model so the canonical values are easy to verify/extend
 * against ArduPilot/PX4 source (spec plan/03 §3.3, plan/04 §4.11).
 *
 * Canonical mode numbers are pinned from ArduPilot's `*_mode` enums; do not edit
 * without cross-checking firmware. No I/O, no state — trivially unit-testable.
 */
import type { VehicleClass } from '../contracts';

/** `MAV_AUTOPILOT_ARDUPILOTMEGA` — ArduPilot custom_mode encoding. */
export const MAV_AUTOPILOT_ARDUPILOTMEGA = 3;
/** `MAV_AUTOPILOT_PX4` — PX4 custom_mode encoding. */
export const MAV_AUTOPILOT_PX4 = 12;

/**
 * `MAV_TYPE` → {@link VehicleClass}. Multirotors and traditional/coaxial helis
 * collapse to `copter`; fixed-wing and all VTOL variants to `plane`; ground
 * rover to `rover`, surface boat to `boat`, submarine to `sub`, antenna tracker
 * to `tracker`. Everything else (GCS, gimbal, ADSB, GENERIC, …) is `unknown`.
 */
export const MAV_TYPE_TO_CLASS: Readonly<Record<number, VehicleClass>> = {
  2: 'copter', // MAV_TYPE_QUADROTOR
  13: 'copter', // MAV_TYPE_HEXAROTOR
  14: 'copter', // MAV_TYPE_OCTOROTOR
  15: 'copter', // MAV_TYPE_TRICOPTER
  4: 'copter', // MAV_TYPE_HELICOPTER
  3: 'copter', // MAV_TYPE_COAXIAL
  29: 'copter', // MAV_TYPE_DODECAROTOR
  1: 'plane', // MAV_TYPE_FIXED_WING
  19: 'plane', // MAV_TYPE_VTOL_DUOROTOR
  20: 'plane', // MAV_TYPE_VTOL_QUADROTOR
  21: 'plane', // MAV_TYPE_VTOL_TILTROTOR
  22: 'plane', // MAV_TYPE_VTOL_RESERVED2
  23: 'plane', // MAV_TYPE_VTOL_RESERVED3
  24: 'plane', // MAV_TYPE_VTOL_RESERVED4
  25: 'plane', // MAV_TYPE_VTOL_RESERVED5
  10: 'rover', // MAV_TYPE_GROUND_ROVER
  11: 'boat', // MAV_TYPE_SURFACE_BOAT
  12: 'sub', // MAV_TYPE_SUBMARINE
  5: 'tracker', // MAV_TYPE_ANTENNA_TRACKER
};

/** Map a `MAV_TYPE` to its {@link VehicleClass}; unmapped types → `unknown`. */
export function classifyMavType(mavType: number): VehicleClass {
  return MAV_TYPE_TO_CLASS[mavType] ?? 'unknown';
}

/** ArduCopter `custom_mode` → mode name (ArduPilot `Mode::Number`). */
export const COPTER_MODES: Readonly<Record<number, string>> = {
  0: 'STABILIZE',
  1: 'ACRO',
  2: 'ALT_HOLD',
  3: 'AUTO',
  4: 'GUIDED',
  5: 'LOITER',
  6: 'RTL',
  7: 'CIRCLE',
  9: 'LAND',
  11: 'DRIFT',
  13: 'SPORT',
  14: 'FLIP',
  15: 'AUTOTUNE',
  16: 'POSHOLD',
  17: 'BRAKE',
  18: 'THROW',
  19: 'AVOID_ADSB',
  20: 'GUIDED_NOGPS',
  21: 'SMART_RTL',
  22: 'FLOWHOLD',
  23: 'FOLLOW',
  24: 'ZIGZAG',
  25: 'SYSTEMID',
  26: 'AUTOROTATE',
  27: 'AUTO_RTL',
};

/** ArduPlane (incl. QuadPlane) `custom_mode` → mode name. */
export const PLANE_MODES: Readonly<Record<number, string>> = {
  0: 'MANUAL',
  1: 'CIRCLE',
  2: 'STABILIZE',
  3: 'TRAINING',
  4: 'ACRO',
  5: 'FBWA',
  6: 'FBWB',
  7: 'CRUISE',
  8: 'AUTOTUNE',
  10: 'AUTO',
  11: 'RTL',
  12: 'LOITER',
  13: 'TAKEOFF',
  14: 'AVOID_ADSB',
  15: 'GUIDED',
  16: 'INITIALISING',
  17: 'QSTABILIZE',
  18: 'QHOVER',
  19: 'QLOITER',
  20: 'QLAND',
  21: 'QRTL',
  22: 'QAUTOTUNE',
  23: 'QACRO',
  24: 'THERMAL',
  25: 'LOITER_ALT_QLAND',
};

/** ArduRover / ArduBoat `custom_mode` → mode name. */
export const ROVER_MODES: Readonly<Record<number, string>> = {
  0: 'MANUAL',
  1: 'ACRO',
  3: 'STEERING',
  4: 'HOLD',
  5: 'LOITER',
  6: 'FOLLOW',
  7: 'SIMPLE',
  8: 'DOCK',
  9: 'CIRCLE',
  10: 'AUTO',
  11: 'RTL',
  12: 'SMART_RTL',
  15: 'GUIDED',
  16: 'INITIALISING',
};

/** ArduSub `custom_mode` → mode name. */
export const SUB_MODES: Readonly<Record<number, string>> = {
  0: 'STABILIZE',
  1: 'ACRO',
  2: 'ALT_HOLD',
  3: 'AUTO',
  4: 'GUIDED',
  7: 'CIRCLE',
  9: 'SURFACE',
  16: 'POSHOLD',
  19: 'MANUAL',
  20: 'MOTORDETECT',
};

/** AntennaTracker `custom_mode` → mode name. */
export const TRACKER_MODES: Readonly<Record<number, string>> = {
  0: 'MANUAL',
  1: 'STOP',
  2: 'SCAN',
  3: 'SERVO_TEST',
  4: 'GUIDED',
  10: 'AUTO',
  16: 'INITIALISING',
};

/** Pick the ArduPilot mode table for a {@link VehicleClass}, if one exists. */
export function arduMapForClass(cls: VehicleClass): Readonly<Record<number, string>> | undefined {
  switch (cls) {
    case 'copter':
      return COPTER_MODES;
    case 'plane':
      return PLANE_MODES;
    case 'rover':
    case 'boat':
      return ROVER_MODES;
    case 'sub':
      return SUB_MODES;
    case 'tracker':
      return TRACKER_MODES;
    case 'unknown':
      return undefined;
  }
}

/**
 * PX4 `custom_mode` main-mode high bytes (`px4_custom_mode.main_mode`, the byte
 * at bits 16–23). Best-effort labels for the common navigation states.
 */
export const PX4_MAIN_MODES: Readonly<Record<number, string>> = {
  1: 'MANUAL',
  2: 'ALTCTL',
  3: 'POSCTL',
  4: 'AUTO',
  5: 'ACRO',
  6: 'OFFBOARD',
  7: 'STABILIZED',
  8: 'RATTITUDE',
  9: 'SIMPLE',
};

/** PX4 AUTO sub-modes (`px4_custom_mode.sub_mode`, bits 24–31, main-mode AUTO). */
export const PX4_AUTO_SUB_MODES: Readonly<Record<number, string>> = {
  1: 'READY',
  2: 'TAKEOFF',
  3: 'LOITER',
  4: 'MISSION',
  5: 'RTL',
  6: 'LAND',
  7: 'RTGS',
  8: 'FOLLOW_TARGET',
  9: 'PRECLAND',
};

/**
 * Best-effort PX4 mode decode from the packed `custom_mode` (main byte at bits
 * 16–23, sub byte at bits 24–31). Falls back to the numeric value when the
 * main-mode byte is zero/unknown (e.g. a vehicle that only sends a flat value).
 */
export function decodePx4Mode(customMode: number): string {
  const mainMode = (customMode >>> 16) & 0xff;
  const subMode = (customMode >>> 24) & 0xff;
  const main = PX4_MAIN_MODES[mainMode];
  if (main === undefined) return String(customMode >>> 0);
  if (mainMode === 4 && subMode !== 0) {
    const sub = PX4_AUTO_SUB_MODES[subMode];
    return sub !== undefined ? `AUTO.${sub}` : main;
  }
  return main;
}

/**
 * Decode a `HEARTBEAT.custom_mode` to a human mode string for the given class +
 * autopilot. ArduPilot uses the per-class tables; PX4 uses {@link decodePx4Mode};
 * any unknown class/autopilot or unmapped value degrades to the numeric value as
 * a string (spec plan/04 §4.11 "unknown types degrade to a generic view").
 */
export function decodeMode(cls: VehicleClass, autopilot: number, customMode: number): string {
  const numeric = String(customMode >>> 0);
  if (autopilot === MAV_AUTOPILOT_ARDUPILOTMEGA) {
    const map = arduMapForClass(cls);
    return map?.[customMode] ?? numeric;
  }
  if (autopilot === MAV_AUTOPILOT_PX4) {
    return decodePx4Mode(customMode);
  }
  return numeric;
}
