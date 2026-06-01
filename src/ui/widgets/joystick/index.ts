/**
 * `ui/widgets/joystick` public surface (task T8.6; spec plan/04 §4.2 joystick,
 * plan/05 §5.4/§5.5).
 *
 * SAFETY-relevant control panel: an enable/disable toggle for live manual
 * control, a loud "MANUAL CONTROL ACTIVE" indicator, a live axis/button readout,
 * per-axis mapping/expo/trim/deadzone editors, output-mode/rate/armed-gate
 * controls, and the focus-loss failsafe (window blur → stop). It drives an
 * injected {@link ManualControlService} + gamepad source and never reaches into
 * the host directly.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). Importing this module registers the `joystick.*`
 * i18n strings as a side effect; mounting the widget also requires
 * `import './joystick.css'` (integration step).
 *
 * @see ./README.md for the data-source contract, what is pure-tested, and how
 *   to test.
 */
import './messages';

export { Joystick } from './joystick';
export {
  createJoystickPanel,
  registerJoystick,
  JOYSTICK_PANEL_ID,
  type JoystickPanelOptions,
} from './register';
export { JOYSTICK_MESSAGES } from './messages';
export type { FailsafeTarget, JoystickProps, TFn } from './types';
