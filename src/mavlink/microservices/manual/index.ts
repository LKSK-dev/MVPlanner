/**
 * `mavlink/microservices/manual` public surface (task T8.6; spec plan/04 §4.2
 * joystick, gated per plan/08 §8.2).
 *
 * The {@link ManualControlService} maps a gamepad onto `RC_CHANNELS_OVERRIDE`
 * (msg 70) or `MANUAL_CONTROL` (msg 69) with per-axis deadzone/expo/trim/reverse,
 * button→action bindings, a bounded send rate, explicit start/stop, an optional
 * armed-state gate, and a focus-loss/disconnect failsafe. The pure axis→channel
 * transforms are exported for reuse + testing. Cross-module consumers import
 * from here, never deep paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the safety contract, owned files, and how to test it.
 */
export {
  ManualControlService,
  createManualControlService,
  DEFAULT_MANUAL_CONFIG,
} from './manual-control-service';
export {
  axisToManual,
  axisToPulse,
  clamp,
  isIgnoredPulse,
  shapeAxis,
  DEFAULT_PULSE_RANGE,
  MANUAL_FULL_SCALE,
  NEUTRAL_SHAPE,
  RC_OVERRIDE_IGNORE,
  RC_OVERRIDE_IGNORE_MAX,
  type AxisShape,
  type PulseRange,
} from './transform';
export {
  DEFAULT_RATE_HZ,
  MAX_RATE_HZ,
  MIN_RATE_HZ,
  MSG_ID_MANUAL_CONTROL,
  MSG_ID_RC_CHANNELS_OVERRIDE,
  MSG_MANUAL_CONTROL,
  MSG_RC_CHANNELS_OVERRIDE,
  RC_OVERRIDE_CHANNELS,
} from './constants';
export type {
  ActionListener,
  ActiveListener,
  ButtonBinding,
  GamepadSnapshot,
  GamepadSource,
  ManualAxisMap,
  ManualAxisMapping,
  ManualControlConfig,
  ManualControlDeps,
  ManualMode,
  ManualStopReason,
  ManualTarget,
  RcChannelMapping,
} from './types';
