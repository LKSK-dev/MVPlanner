/**
 * i18n registration for the flight-modes setup step (T5.7). All keys are under
 * `setup.modes.*` and are contributed through the public registerMessages seam.
 */
import { registerMessages } from '../../../../core/i18n';

/** English strings owned by the flight-modes setup step. */
export const MODES_MESSAGES: Readonly<Record<string, string>> = {
  'setup.modes.title': 'Flight modes',
  'setup.modes.safety':
    'Flight-mode assignments affect how the vehicle responds to the RC mode switch. Remove propellers and verify failsafes before testing changes.',
  'setup.modes.description':
    'Map the six RC switch positions to ArduPilot flight modes for the detected vehicle class.',
  'setup.modes.vehicleClass': 'Vehicle class: {vehicleClass}',
  'setup.modes.noModes':
    'No ArduPilot mode table is available for this vehicle class. Use the full parameter editor for advanced setup.',
  'setup.modes.channel.label': 'Mode switch channel',
  'setup.modes.channel.aria': 'Flight mode switch RC channel',
  'setup.modes.channel.disabled': 'Disabled',
  'setup.modes.channel.option': 'RC channel {channel}',
  'setup.modes.position.label': 'Switch position {position}',
  'setup.modes.position.aria': 'Flight mode for switch position {position}',
  'setup.modes.select.placeholder': 'Select a flight mode',
  'setup.modes.mode.option': '{name} ({value})',
  'setup.modes.mode.unknown': 'Current mode {value} (not in this vehicle mode table)',
  'setup.modes.simple.title': 'Simple mode flags',
  'setup.modes.simple.enable': 'Simple',
  'setup.modes.superSimple.enable': 'Super-simple',
  'setup.modes.simple.aria': 'Enable simple mode for switch position {position}',
  'setup.modes.superSimple.aria': 'Enable super-simple mode for switch position {position}',
  'setup.modes.status.done': 'FLTMODE_CH is set and at least one switch position is configured.',
  'setup.modes.status.todo': 'Set FLTMODE_CH and configure at least one switch position.',
  'setup.modes.saving': 'Writing {name}…',
  'setup.modes.error': 'Flight mode parameter operation failed: {message}',
};

let registered = false;

/** Register flight-modes setup English messages once (idempotent). */
export function registerModesMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(MODES_MESSAGES);
}

registerModesMessages();
