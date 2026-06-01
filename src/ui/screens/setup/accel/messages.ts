/**
 * i18n registration for the Accelerometer + level setup step (task T5.4;
 * conventions plan/implementation/00 §0.3, spec plan/04 §4.4 accel). The step
 * owns the disjoint `setup.accel.*` namespace and registers it additively via
 * the public `registerMessages` seam.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `setup.accel.*` strings owned by the accel calibration step. */
export const SETUP_ACCEL_MESSAGES: Readonly<Record<string, string>> = {
  'setup.accel.title': 'Accelerometer',
  'setup.accel.safety':
    'Remove propellers and keep the vehicle still for each pose. Place it on a stable surface before confirming each orientation.',
  'setup.accel.intro':
    'Runs the full six-point accelerometer calibration, then optionally calibrates the level attitude while the vehicle is sitting level.',

  'setup.accel.start': 'Start 6-point calibration',
  'setup.accel.restart': 'Calibrate again',
  'setup.accel.positioned': 'Vehicle is positioned',
  'setup.accel.positioned.disabled': 'Waiting for the vehicle to request the next position',

  'setup.accel.state.idle': 'Not started.',
  'setup.accel.state.running': 'Accelerometer calibration is running.',
  'setup.accel.state.done': 'Accelerometer calibration complete.',
  'setup.accel.state.warning': 'Accelerometer calibration needs attention.',
  'setup.accel.error':
    'Accelerometer calibration failed. Keep the vehicle still in each pose and try again.',

  'setup.accel.current.pending': 'Start calibration and wait for the first vehicle position.',
  'setup.accel.current.face': '{label}: face {current} of {total}. {instruction}',
  'setup.accel.progress': 'Face {current} of {total}',
  'setup.accel.face.done': 'Position confirmed',
  'setup.accel.face.todo': 'Waiting',
  'setup.accel.face.current': 'Current position',

  'setup.accel.face.level.label': 'Level',
  'setup.accel.face.level.instruction': 'Place the vehicle level on its landing gear.',
  'setup.accel.face.left.label': 'Left side',
  'setup.accel.face.left.instruction': 'Roll the vehicle onto its LEFT side.',
  'setup.accel.face.right.label': 'Right side',
  'setup.accel.face.right.instruction': 'Roll the vehicle onto its RIGHT side.',
  'setup.accel.face.nosedown.label': 'Nose down',
  'setup.accel.face.nosedown.instruction': 'Point the nose DOWN.',
  'setup.accel.face.noseup.label': 'Nose up',
  'setup.accel.face.noseup.instruction': 'Point the nose UP.',
  'setup.accel.face.back.label': 'Back',
  'setup.accel.face.back.instruction': 'Place the vehicle on its BACK (upside down).',

  'setup.accel.level.title': 'Level calibration',
  'setup.accel.level.body':
    'Use this after the six-point calibration if the vehicle sits slightly tilted when it should be level.',
  'setup.accel.level.button': 'Calibrate Level',
  'setup.accel.level.state.idle': 'Level calibration not run.',
  'setup.accel.level.state.running': 'Calibrating level — keep the vehicle still and level.',
  'setup.accel.level.state.done': 'Level calibration complete.',
  'setup.accel.level.state.warning':
    'Level calibration failed. Place the vehicle level and try again.',
};

let registered = false;

/** Register the accel step's `setup.accel.*` English catalog once. */
export function registerAccelMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(SETUP_ACCEL_MESSAGES);
}

registerAccelMessages();
