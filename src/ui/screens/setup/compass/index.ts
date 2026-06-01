/**
 * `ui/screens/setup/compass` public surface (task T5.5; spec plan/04 §4.4
 * compass). The Compass calibration setup step: a {@link createCompassStep}
 * factory that builds a {@link import('../framework').SetupStep} driving onboard
 * `MAG_CAL` through the injected `CalibrationClient`, with a live progress bar,
 * per-compass fitness, resulting offsets, and optional declination/orientation
 * hints read from a `ParamClient`.
 *
 * Cross-module consumers (the Setup screen assembly, T5.12) import from here,
 * never deep paths (conventions plan/implementation/00 §0.3). The
 * `setup.compass.*` English strings register as a side effect of importing the
 * step module.
 *
 * @see ./README.md for the calibration-flow states and how to test.
 */
export { createCompassStep, type CompassStepDeps } from './compass-setup';
export {
  clampPct,
  deriveResultState,
  flowStatusKey,
  flowToSettledStatus,
  isPoorFitness,
  DEFAULT_POOR_FITNESS_MGAUSS,
  type CompassFlowState,
  type CompassOutcome,
  type CompassProgress,
} from './derivation';
export { registerCompassMessages, SETUP_COMPASS_MESSAGES } from './messages';
