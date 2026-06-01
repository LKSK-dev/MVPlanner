/**
 * i18n registration for the Compass calibration setup step (task T5.5;
 * conventions plan/implementation/00 §0.3, spec plan/04 §4.4 compass, plan/05
 * §5.9). Contributes the disjoint `setup.compass.*` namespace to the English
 * catalog via the public {@link registerMessages} seam. Registration runs once
 * at import and is idempotent.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `setup.compass.*` strings owned by the compass calibration step. */
export const SETUP_COMPASS_MESSAGES: Readonly<Record<string, string>> = {
  'setup.compass.title': 'Compass',
  'setup.compass.safety':
    'Rotate the vehicle slowly through all orientations (nose, tail, left, right, top, bottom) until each axis completes. Keep clear of magnetic interference (metal, magnets, motors, currents).',
  'setup.compass.intro':
    'Runs onboard magnetometer calibration (MAG_CAL). Start, rotate the vehicle through every orientation, and the firmware computes the compass offsets.',

  'setup.compass.start': 'Start calibration',
  'setup.compass.restart': 'Calibrate again',
  'setup.compass.cancel': 'Cancel',

  'setup.compass.progress.label': 'Compass calibration progress',
  'setup.compass.progress.value': '{pct}% complete',

  'setup.compass.fitness.label': 'Fitness',
  'setup.compass.fitness.value': '{value} mGauss',
  'setup.compass.fitness.poor': 'Poor fit — consider recalibrating away from interference.',

  'setup.compass.offsets.title': 'Compass offsets',
  'setup.compass.offsets.axis': '{axis}: {value}',

  'setup.compass.state.idle': 'Not started.',
  'setup.compass.state.running': 'Calibrating — rotate the vehicle through all orientations.',
  'setup.compass.state.done': 'Calibration complete.',
  'setup.compass.state.warning': 'Calibration needs attention.',
  'setup.compass.error': 'Compass calibration failed. Move away from interference and try again.',

  'setup.compass.declination.title': 'Declination',
  'setup.compass.declination.auto': 'Automatic (from world magnetic model)',
  'setup.compass.declination.manual': 'Manual: {deg}°',

  'setup.compass.orientation.title': 'Orientation',
  'setup.compass.orientation.value': 'COMPASS_ORIENT = {value}',
};

let registered = false;

/** Register the compass step's `setup.compass.*` English catalog once. */
export function registerCompassMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(SETUP_COMPASS_MESSAGES);
}

registerCompassMessages();
