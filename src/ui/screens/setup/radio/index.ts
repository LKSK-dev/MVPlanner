/**
 * `ui/screens/setup/radio` public surface (task T5.6; spec plan/04 §4.4 radio).
 * Consumers compose {@link createRadioStep} into the setup wizard registry. The
 * step streams live `RC_CHANNELS` through `CalibrationClient.radio`, accumulates
 * per-channel min/max/trim in pure helpers, and writes `RCn_MIN/MAX/TRIM` with a
 * `ParamClient` when saved.
 */
export { createRadioStep, type RadioStepDeps } from './radio-step';
export {
  EMPTY_RADIO_CAPTURE,
  RADIO_PWM_DISPLAY_MAX,
  RADIO_PWM_DISPLAY_MIN,
  accumulateRadioChannels,
  clamp,
  radioBarPercent,
  radioParamWrites,
  type RadioCaptureState,
  type RadioChannelCapture,
  type RadioParamWrite,
} from './capture';
export { registerRadioMessages, SETUP_RADIO_MESSAGES } from './messages';
