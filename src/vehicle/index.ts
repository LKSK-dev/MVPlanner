/**
 * Vehicle model public surface (task T1.5; spec plan/03 §3.3, plan/04 §4.11).
 *
 * An INTERNAL module (no frozen contract to implement) that ingests
 * {@link DecodedMessage}s and derives a typed {@link VehicleState} per
 * `(sysid, compid)`: vehicle class from `MAV_TYPE`, armed/mode from `HEARTBEAT`,
 * and position / velocity / attitude / battery / GPS / EKF health / home /
 * firmware from their respective messages. Flight-mode tables live in the
 * separate {@link ./mode-maps} data module so they are easy to verify/extend.
 *
 * @see ./README.md for the contract, owned files, and how to test.
 */
export { VehicleModel } from './model';
export type { VehicleModelOptions, VehicleChangeListener } from './model';
export {
  classifyMavType,
  decodeMode,
  decodePx4Mode,
  arduMapForClass,
  MAV_TYPE_TO_CLASS,
  COPTER_MODES,
  PLANE_MODES,
  ROVER_MODES,
  SUB_MODES,
  TRACKER_MODES,
  PX4_MAIN_MODES,
  PX4_AUTO_SUB_MODES,
  MAV_AUTOPILOT_ARDUPILOTMEGA,
  MAV_AUTOPILOT_PX4,
} from './mode-maps';
