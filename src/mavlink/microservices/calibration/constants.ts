/**
 * MAVLink calibration command/message/status identifiers (T5.1; spec plan/03
 * §3.4 Calibration). Values are resolved from the bundled dialect tables with
 * MAVLink literals as stable fallbacks.
 */
import type { DialectTable } from '../../../contracts';
import { ardupilotmegaDialect, commonDialect } from '../../dialects';

const DIALECTS: readonly DialectTable[] = [ardupilotmegaDialect, commonDialect];

/** Resolve a `MAV_CMD` entry value by name, falling back to `fallback`. */
function cmdId(name: string, fallback: number): number {
  for (const d of DIALECTS) {
    const value = d.enums.MAV_CMD?.find((e) => e.name === name)?.value;
    if (value !== undefined) return value;
  }
  return fallback;
}

/** Resolve an enum entry value by name, falling back to `fallback`. */
function enumVal(enumName: string, name: string, fallback: number): number {
  for (const d of DIALECTS) {
    const value = d.enums[enumName]?.find((e) => e.name === name)?.value;
    if (value !== undefined) return value;
  }
  return fallback;
}

/** Resolve a message id by name, falling back to `fallback`. */
function msgId(name: string, fallback: number): number {
  for (const d of DIALECTS) {
    for (const m of Object.values(d.messages)) if (m.name === name) return m.id;
  }
  return fallback;
}

/** `MAV_CMD_PREFLIGHT_CALIBRATION` — gyro/level/accel/radio calibration entry. */
export const CMD_PREFLIGHT_CALIBRATION = cmdId('MAV_CMD_PREFLIGHT_CALIBRATION', 241);
/** `MAV_CMD_ACCELCAL_VEHICLE_POS` — advance accel 6-point calibration. */
export const CMD_ACCELCAL_VEHICLE_POS = cmdId('MAV_CMD_ACCELCAL_VEHICLE_POS', 42429);
/** `MAV_CMD_DO_START_MAG_CAL` — start onboard compass calibration. */
export const CMD_DO_START_MAG_CAL = cmdId('MAV_CMD_DO_START_MAG_CAL', 42424);
/** `MAV_CMD_DO_ACCEPT_MAG_CAL` — accept onboard compass calibration. */
export const CMD_DO_ACCEPT_MAG_CAL = cmdId('MAV_CMD_DO_ACCEPT_MAG_CAL', 42425);
/** `MAV_CMD_DO_CANCEL_MAG_CAL` — cancel onboard compass calibration. */
export const CMD_DO_CANCEL_MAG_CAL = cmdId('MAV_CMD_DO_CANCEL_MAG_CAL', 42426);

/** `MAG_CAL_PROGRESS` (191). */
export const MSG_MAG_CAL_PROGRESS = msgId('MAG_CAL_PROGRESS', 191);
/** `MAG_CAL_REPORT` (192). */
export const MSG_MAG_CAL_REPORT = msgId('MAG_CAL_REPORT', 192);
/** `STATUSTEXT` (253). */
export const MSG_STATUSTEXT = msgId('STATUSTEXT', 253);
/** `RC_CHANNELS` (65). */
export const MSG_RC_CHANNELS = msgId('RC_CHANNELS', 65);

/** Accel calibration vehicle positions, in ArduPilot's required sequence. */
export const ACCEL_POS = {
  LEVEL: enumVal('ACCELCAL_VEHICLE_POS', 'ACCELCAL_VEHICLE_POS_LEVEL', 1),
  LEFT: enumVal('ACCELCAL_VEHICLE_POS', 'ACCELCAL_VEHICLE_POS_LEFT', 2),
  RIGHT: enumVal('ACCELCAL_VEHICLE_POS', 'ACCELCAL_VEHICLE_POS_RIGHT', 3),
  NOSEDOWN: enumVal('ACCELCAL_VEHICLE_POS', 'ACCELCAL_VEHICLE_POS_NOSEDOWN', 4),
  NOSEUP: enumVal('ACCELCAL_VEHICLE_POS', 'ACCELCAL_VEHICLE_POS_NOSEUP', 5),
  BACK: enumVal('ACCELCAL_VEHICLE_POS', 'ACCELCAL_VEHICLE_POS_BACK', 6),
  SUCCESS: enumVal('ACCELCAL_VEHICLE_POS', 'ACCELCAL_VEHICLE_POS_SUCCESS', 16777215),
  FAILED: enumVal('ACCELCAL_VEHICLE_POS', 'ACCELCAL_VEHICLE_POS_FAILED', 16777216),
} as const;

/** `MAG_CAL_STATUS` terminal/sentinel values used by compass calibration. */
export const MAG_CAL_STATUS = {
  NOT_STARTED: enumVal('MAG_CAL_STATUS', 'MAG_CAL_NOT_STARTED', 0),
  WAITING_TO_START: enumVal('MAG_CAL_STATUS', 'MAG_CAL_WAITING_TO_START', 1),
  RUNNING_STEP_ONE: enumVal('MAG_CAL_STATUS', 'MAG_CAL_RUNNING_STEP_ONE', 2),
  RUNNING_STEP_TWO: enumVal('MAG_CAL_STATUS', 'MAG_CAL_RUNNING_STEP_TWO', 3),
  SUCCESS: enumVal('MAG_CAL_STATUS', 'MAG_CAL_SUCCESS', 4),
  FAILED: enumVal('MAG_CAL_STATUS', 'MAG_CAL_FAILED', 5),
  BAD_ORIENTATION: enumVal('MAG_CAL_STATUS', 'MAG_CAL_BAD_ORIENTATION', 6),
  BAD_RADIUS: enumVal('MAG_CAL_STATUS', 'MAG_CAL_BAD_RADIUS', 7),
} as const;

/** Ordered accel 6-point faces surfaced to UI code through `step(face)`. */
export const ACCEL_FACES: readonly { name: string; value: number }[] = [
  { name: 'LEVEL', value: ACCEL_POS.LEVEL },
  { name: 'LEFT', value: ACCEL_POS.LEFT },
  { name: 'RIGHT', value: ACCEL_POS.RIGHT },
  { name: 'NOSEDOWN', value: ACCEL_POS.NOSEDOWN },
  { name: 'NOSEUP', value: ACCEL_POS.NOSEUP },
  { name: 'BACK', value: ACCEL_POS.BACK },
];
