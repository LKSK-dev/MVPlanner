/**
 * Public surface for the Setup ESC calibration + motor test step (T5.10).
 * Consumers compose this `SetupStep` into the setup wizard registry and inject a
 * `CommandClient` (narrowed to `send`), the destructive-action `confirm` gate,
 * and optionally a `ParamClient`. Cross-module consumers import from here, never
 * deep paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the command mapping and the safety-gating design.
 */
export { createMotorsStep, type MotorsStepDeps } from './motors-step';
export {
  MAV_CMD_DO_MOTOR_TEST,
  MOTOR_TEST_THROTTLE_PERCENT,
  MOTOR_TEST_THROTTLE_PWM,
  MOTOR_TEST_THROTTLE_PILOT,
  MOTOR_TEST_ORDER_DEFAULT,
  MOTOR_TEST_ORDER_SEQUENCE,
  MOTOR_TEST_ORDER_BOARD,
  DEFAULT_MOTOR_TEST_THROTTLE_PCT,
  DEFAULT_MOTOR_TEST_TIMEOUT_S,
  MAX_MOTOR_TEST_THROTTLE_PCT,
  MAX_MOTOR_TEST_TIMEOUT_S,
  MAX_MOTOR_COUNT,
  ESC_CALIBRATION_PARAM,
  ESC_CALIBRATION_NORMAL,
  ESC_CALIBRATION_ENABLE,
  clampThrottlePct,
  clampTimeoutS,
  clampMotorCount,
  defaultMotorCount,
  motorInstances,
  motorTestCommandParams,
  motorTestStopParams,
  type MotorTestRequest,
} from './motor-test';
export { registerMotorsMessages, SETUP_MOTORS_MESSAGES } from './messages';
