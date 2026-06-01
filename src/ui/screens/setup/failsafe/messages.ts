/** i18n registration for the failsafe setup step (T5.8). */
import { registerMessages } from '../../../../core/i18n';

/** English strings owned by `setup.failsafe.*`. */
export const FAILSAFE_MESSAGES: Readonly<Record<string, string>> = {
  'setup.failsafe.title': 'Failsafe',
  'setup.failsafe.safety':
    'Review failsafe actions with props removed. Thresholds and actions can change how the vehicle responds to RC, battery, GCS, and EKF/GPS loss events.',
  'setup.failsafe.intro':
    'Configure ArduPilot failsafe actions and thresholds for the connected vehicle.',
  'setup.failsafe.vehicleClass': 'Vehicle class: {vehicleClass}',
  'setup.failsafe.empty': 'No supported failsafe parameters are currently present in the cache.',
  'setup.failsafe.pending': 'Writing…',
  'setup.failsafe.valueFor': 'Value for {name}',
  'setup.failsafe.units': 'Units: {units}',

  'setup.failsafe.section.rc': 'RC',
  'setup.failsafe.section.battery': 'Battery',
  'setup.failsafe.section.gcs': 'GCS',
  'setup.failsafe.section.ekfGps': 'EKF / GPS',

  'setup.failsafe.field.FS_THR_ENABLE': 'RC failsafe action',
  'setup.failsafe.field.FS_THR_VALUE': 'RC throttle threshold',
  'setup.failsafe.field.BATT_LOW_VOLT': 'Low battery voltage',
  'setup.failsafe.field.BATT_LOW_MAH': 'Low battery capacity',
  'setup.failsafe.field.BATT_FS_LOW_ACT': 'Low battery action',
  'setup.failsafe.field.BATT_CRT_VOLT': 'Critical battery voltage',
  'setup.failsafe.field.BATT_FS_CRT_ACT': 'Critical battery action',
  'setup.failsafe.field.FS_GCS_ENABLE': 'GCS failsafe action',
  'setup.failsafe.field.FS_EKF_ACTION': 'EKF / GPS failsafe action',
  'setup.failsafe.field.FS_EKF_THRESH': 'EKF / GPS threshold',
};

let registered = false;

/** Register failsafe setup messages once. */
export function registerFailsafeMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(FAILSAFE_MESSAGES);
}

registerFailsafeMessages();
