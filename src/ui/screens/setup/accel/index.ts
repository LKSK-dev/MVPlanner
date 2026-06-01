/**
 * `ui/screens/setup/accel` public surface (task T5.4; spec plan/04 §4.4
 * accel). Provides {@link createAccelStep}, a setup-wizard step for full
 * six-point accelerometer calibration plus the separate level calibration
 * action. The step drives only the injected `CalibrationClient` seam and owns
 * the `setup.accel.*` i18n namespace.
 *
 * @see ./README.md for the calibration-flow states and testing notes.
 */
export { createAccelStep, type AccelStepDeps } from './accel-setup';
export {
  ACCEL_FACE_SEQUENCE,
  accelFaceDefinition,
  accelFaceProgress,
  accelFlowStatusKey,
  flowsToSettledStatus,
  levelFlowStatusKey,
  normalizeAccelFace,
  type AccelFaceDefinition,
  type AccelFaceId,
  type AccelFaceProgress,
  type AccelFlowState,
  type LevelFlowState,
} from './derivation';
export { registerAccelMessages, SETUP_ACCEL_MESSAGES } from './messages';
