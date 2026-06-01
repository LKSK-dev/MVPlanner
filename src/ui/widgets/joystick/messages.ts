/**
 * Joystick / gamepad control-panel i18n strings (task T8.6; conventions
 * plan/implementation/00 §0.3, spec plan/05 §5.9).
 *
 * The widget owns its `joystick.*` keys and contributes them at IMPORT TIME via
 * the public {@link registerMessages} seam — it never edits the central English
 * catalog or the i18n internals. Importing this module (the component and the
 * barrel both do) is enough to make `t('joystick.*')` resolve.
 */
import { registerMessages } from '../../../core/i18n';

/** The shipped English `joystick.*` strings. */
export const JOYSTICK_MESSAGES: Readonly<Record<string, string>> = {
  'joystick.title': 'Joystick',
  'joystick.panel.label': 'Joystick / gamepad control',
  'joystick.open': 'Open Joystick control',
  'joystick.enable': 'Enable manual control',
  'joystick.disable': 'Disable manual control',
  'joystick.active': 'MANUAL CONTROL ACTIVE',
  'joystick.inactive': 'Manual control off',
  'joystick.warning': 'Manual control sends live RC commands to the vehicle. Use with caution.',
  'joystick.failsafeNote': 'Stops and releases on window focus loss or controller disconnect.',
  'joystick.mode': 'Output',
  'joystick.mode.rc': 'RC override',
  'joystick.mode.manual': 'Manual control',
  'joystick.rate': 'Send rate (Hz)',
  'joystick.requireArmed': 'Only send when armed',
  'joystick.live': 'Live input',
  'joystick.axes': 'Axes',
  'joystick.buttons': 'Buttons',
  'joystick.axisLabel': 'Axis {n}',
  'joystick.buttonLabel': 'Button {n}',
  'joystick.noGamepad': 'No gamepad detected. Connect a controller and press a button.',
  'joystick.mappings': 'Axis mapping',
  'joystick.noMappings': 'No axes mapped yet.',
  'joystick.axisName.x': 'Pitch (x)',
  'joystick.axisName.y': 'Roll (y)',
  'joystick.axisName.z': 'Throttle (z)',
  'joystick.axisName.r': 'Yaw (r)',
  'joystick.channel': 'Channel',
  'joystick.axis': 'Gamepad axis',
  'joystick.deadzone': 'Deadzone',
  'joystick.expo': 'Expo',
  'joystick.trim': 'Trim',
  'joystick.reverse': 'Reverse',
};

registerMessages(JOYSTICK_MESSAGES);
