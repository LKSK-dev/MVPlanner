/**
 * `ui/widgets/gauges` public surface (task T2.2; spec plan/04 §4.2 instruments,
 * plan/05 §5.5). A set of small, composable, themeable, accessible instrument
 * gauges + value-cards that each take REACTIVE accessor props, plus a registry
 * and a container so the Flight screen (T2.11) can wire the store and pick which
 * gauges to show.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). Importing this module registers the `gauges.*`
 * i18n strings as a side effect.
 *
 * @see ./README.md for the gauge list, prop API and selection mechanism.
 */
import './register';

export { InstrumentPanel, type InstrumentPanelProps } from './panel';
export {
  GAUGES,
  DEFAULT_GAUGE_SELECTION,
  getGauge,
  resolveSelection,
  type GaugeDescriptor,
} from './registry';
export { AttitudeGauge, CompassGauge, VsiGauge } from './canvas-gauges';
export { CanvasGauge, type CanvasGaugeProps } from './canvas-gauge';
export {
  ValueCard,
  type ValueCardProps,
  AirspeedGauge,
  BatteryGauge,
  GpsGauge,
  EkfGauge,
  VibeGauge,
  RcGauge,
  SystemGauge,
  LinkGauge,
  NavGauge,
} from './value-cards';
export { metricUnits, unitsFromResolved, type UnitHook, type UnitFormat } from './units';
export { GAUGE_MESSAGES, registerGaugeMessages } from './register';
export {
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
} from './format';
export {
  clamp,
  radToDeg,
  normalizeHeadingDeg,
  attitudeGeometry,
  compassGeometry,
  vsiGeometry,
  ATTITUDE_PITCH_FOV_RAD,
  VSI_MAX_DEFAULT_MS,
  VSI_SWEEP_RAD,
  type AttitudeGeometry,
  type CompassGeometry,
  type VsiGeometry,
} from './geometry';
export type {
  GaugeProps,
  GaugeReading,
  GaugeStatus,
  RcState,
  NavProgress,
  TFn,
  LabelVars,
} from './types';
