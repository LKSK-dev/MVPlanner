/**
 * i18n registration for the battery monitor setup step (T5.9). The step owns
 * only the `setup.battery.*` namespace and contributes English strings through
 * the public `registerMessages` seam.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `setup.battery.*` strings. */
export const SETUP_BATTERY_MESSAGES: Readonly<Record<string, string>> = {
  'setup.battery.title': 'Battery monitor',
  'setup.battery.safety':
    'Configure battery sensing with props removed and the vehicle powered safely. Verify voltage/current readings before flight.',
  'setup.battery.description':
    'Select the ArduPilot battery monitor type, then tune analog pins and scaling or apply a known power-module preset.',
  'setup.battery.monitor.label': 'Monitor type',
  'setup.battery.monitor.disabled': 'Disabled',
  'setup.battery.monitor.voltageOnly': 'Analog Voltage Only',
  'setup.battery.monitor.voltageCurrent': 'Analog Voltage and Current',
  'setup.battery.monitor.solo': 'Solo',
  'setup.battery.monitor.bebop': 'Bebop',
  'setup.battery.monitor.smbusMaxell': 'SMBus-Maxell',
  'setup.battery.monitor.uavcan': 'UAVCAN-BatteryInfo',
  'setup.battery.monitor.custom': 'Custom/current monitor',
  'setup.battery.preset.label': 'Power-module preset',
  'setup.battery.preset.custom': 'Choose a preset…',
  'setup.battery.preset.apply': 'Apply preset',
  'setup.battery.preset.pixhawkStandard': 'Pixhawk standard',
  'setup.battery.preset.powerModule90A': 'Power Module 90A',
  'setup.battery.preset.holybroPm02': 'Holybro PM02 / PM07',
  'setup.battery.field.voltagePin': 'Voltage pin',
  'setup.battery.field.currentPin': 'Current pin',
  'setup.battery.field.voltageMultiplier': 'Voltage multiplier / divider',
  'setup.battery.field.ampsPerVolt': 'Amps per volt',
  'setup.battery.field.ampOffset': 'Amp offset',
  'setup.battery.field.capacity': 'Capacity (mAh)',
  'setup.battery.status.ready': 'Current values loaded from the parameter cache.',
  'setup.battery.status.wrote': 'Wrote {param}.',
  'setup.battery.status.preset': 'Applied {preset}.',
  'setup.battery.status.error': 'Battery parameter write failed: {message}',
};

let registered = false;

/** Register the battery setup messages once (idempotent). */
export function registerBatteryMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(SETUP_BATTERY_MESSAGES);
}

registerBatteryMessages();
