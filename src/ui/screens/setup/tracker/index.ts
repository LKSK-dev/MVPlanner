/**
 * Public surface for antenna-tracker support (task T8.9; spec plan/04 §4.12).
 *
 * Consumers construct a {@link TrackerService} with host send/tap seams, an
 * active-vehicle accessor and (optionally) a `ParamClient`, then render the
 * {@link TrackerPanel} bound to it.
 */
export {
  TrackerService,
  createTrackerService,
  MAV_TYPE_ANTENNA_TRACKER,
  type TrackerServiceDeps,
  type TrackerSendFn,
  type TrackerMessageTap,
  type TrackerTarget,
  type TrackerPointing,
  type TrackerState,
} from './tracker-service';
export {
  computePointing,
  bearingDeg,
  groundDistanceM,
  normalizeAzimuthDeg,
  type GeoPoint,
  type Pointing,
} from './pointing';
export {
  TRACKER_CONFIG_FIELDS,
  TRACKER_SERVO_TYPE_OPTIONS,
  defaultTrackerConfig,
  readTrackerConfig,
  type TrackerConfig,
  type TrackerConfigField,
  type TrackerEnumOption,
  type TrackerParamName,
} from './config';
export { TrackerPanel, type TrackerPanelProps } from './tracker-panel';
export { registerTrackerMessages, TRACKER_MESSAGES } from './messages';
