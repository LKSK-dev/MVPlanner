/**
 * i18n registration for the ESC calibration + motor test setup step (T5.10).
 * The step owns only the `setup.motors.*` namespace and contributes English
 * strings through the public `registerMessages` seam (idempotent at import).
 */
import { registerMessages } from '../../../../core/i18n';

/** English `setup.motors.*` strings. */
export const SETUP_MOTORS_MESSAGES: Readonly<Record<string, string>> = {
  'setup.motors.title': 'ESC calibration & motor test',
  'setup.motors.safety':
    'DANGER: these tools spin propellers. REMOVE ALL PROPELLERS before continuing. Keep clear of motors, disarm the vehicle, and never run motor tests near people.',
  'setup.motors.description':
    'Optional checks for ESC calibration and per-motor wiring/spin direction. Every motor command requires you to confirm propellers are removed.',

  // Persistent "props removed" acknowledgement gate.
  'setup.motors.ack.label': 'I confirm all propellers are REMOVED',
  'setup.motors.ack.help': 'Motor controls stay disabled until you acknowledge this.',
  'setup.motors.armed.warning':
    'Vehicle is ARMED or in the air — motor tests are disabled. Disarm before testing.',

  // Motor test section.
  'setup.motors.test.title': 'Motor test',
  'setup.motors.test.throttle': 'Throttle (%)',
  'setup.motors.test.timeout': 'Timeout (s)',
  'setup.motors.test.count': 'Motor count',
  'setup.motors.test.motor': 'Test motor {n}',
  'setup.motors.test.all': 'Test all in sequence',
  'setup.motors.test.motorLabel': 'Motor {n}',
  'setup.motors.confirm.title': 'Confirm propellers are REMOVED',
  'setup.motors.confirm.body':
    'This will SPIN motor {n} at {throttle}% for {timeout}s. Confirm all propellers are removed and everyone is clear of the vehicle.',
  'setup.motors.confirm.bodyAll':
    'This will SPIN {count} motors in sequence at {throttle}% for {timeout}s each. Confirm all propellers are removed and everyone is clear of the vehicle.',

  // Emergency stop.
  'setup.motors.stop': 'EMERGENCY STOP',
  'setup.motors.stop.help': 'Immediately commands all motors to stop.',

  // ESC calibration section.
  'setup.motors.esc.title': 'ESC calibration',
  'setup.motors.esc.warning':
    'All-at-once ESC calibration spins motors at full throttle on reboot. Remove propellers and follow each step exactly.',
  'setup.motors.esc.steps.intro': 'Guided all-at-once ESC calibration:',
  'setup.motors.esc.steps.s1': 'Remove all propellers and disconnect the battery.',
  'setup.motors.esc.steps.s2': 'Press “Arm ESC calibration” to set the calibration parameter.',
  'setup.motors.esc.steps.s3': 'Reboot the flight controller, then connect the battery.',
  'setup.motors.esc.steps.s4':
    'The ESCs record max/min throttle; wait for the confirmation tones, then disconnect the battery.',
  'setup.motors.esc.steps.s5':
    'Press “Reset to normal” to clear the calibration parameter for normal flight.',
  'setup.motors.esc.arm': 'Arm ESC calibration',
  'setup.motors.esc.reset': 'Reset to normal',
  'setup.motors.esc.confirm.title': 'Confirm propellers are REMOVED',
  'setup.motors.esc.confirm.body':
    'This sets {param}={value} so the next reboot enters ESC calibration, which spins motors at FULL throttle. Confirm all propellers are removed.',
  'setup.motors.esc.unavailable':
    'ESC calibration parameter writes are unavailable (no parameter client connected). Follow the manual steps above.',
  'setup.motors.esc.armed': 'ESC calibration armed: reboot the flight controller to begin.',
  'setup.motors.esc.reset.done': 'ESC calibration parameter reset to normal.',

  // Status line.
  'setup.motors.status.idle': 'No motor command sent yet.',
  'setup.motors.status.declined': 'Cancelled — no motor command was sent.',
  'setup.motors.status.sent': 'Commanded motor {n} at {throttle}% for {timeout}s.',
  'setup.motors.status.sentAll': 'Commanded {count} motors in sequence at {throttle}%.',
  'setup.motors.status.stopped': 'Emergency stop sent to all motors.',
  'setup.motors.status.error': 'Motor command failed: {message}',
};

let registered = false;

/** Register the motor/ESC setup messages once (idempotent). */
export function registerMotorsMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(SETUP_MOTORS_MESSAGES);
}

registerMotorsMessages();
