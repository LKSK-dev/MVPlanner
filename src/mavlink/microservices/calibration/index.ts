/**
 * `mavlink/microservices/calibration` public surface (task T5.1; spec plan/03
 * §3.4 Calibration). Implements the frozen `CalibrationClient` contract for
 * gyro, level, accel 6-point, onboard compass MAG_CAL, and radio capture.
 *
 * @see ./README.md for command/message ids, behavior, and validation notes.
 */
export { CalibrationClient, CalibrationError, createCalibrationClient } from './calibration-client';
export type {
  CalibrationClientDeps,
  CalibrationClock,
  CalibrationErrorReason,
  CalibrationMessageTap,
  CalibrationTarget,
  CalibrationTargetAccessor,
} from './calibration-client';
export {
  ACCEL_FACES,
  ACCEL_POS,
  CMD_ACCELCAL_VEHICLE_POS,
  CMD_DO_ACCEPT_MAG_CAL,
  CMD_DO_CANCEL_MAG_CAL,
  CMD_DO_START_MAG_CAL,
  CMD_PREFLIGHT_CALIBRATION,
  MAG_CAL_STATUS,
  MSG_MAG_CAL_PROGRESS,
  MSG_MAG_CAL_REPORT,
  MSG_RC_CHANNELS,
  MSG_STATUSTEXT,
} from './constants';
