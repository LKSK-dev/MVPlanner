/**
 * i18n registration for the Flight actions bar + audit viewer (task T2.7;
 * conventions plan/implementation/00 §0.3, spec plan/05 §5.9).
 *
 * Contributes the `actions.*` and `audit.*` namespaces to the English catalog
 * via the public {@link registerMessages} seam (never edits the i18n internals).
 * Registration runs once at import and is idempotent; the barrel imports this
 * for its side effect so consumers get the strings for free.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `actions.*` strings contributed by the actions bar. */
export const ACTIONS_MESSAGES: Readonly<Record<string, string>> = {
  'actions.title': 'Actions',
  'actions.region.label': 'Quick vehicle actions',

  // Button / command labels.
  'actions.arm': 'Arm',
  'actions.disarm': 'Disarm',
  'actions.takeoff': 'Takeoff',
  'actions.land': 'Land',
  'actions.rtl': 'RTL',
  'actions.loiter': 'Loiter',
  'actions.auto': 'Auto',
  'actions.pause': 'Pause',
  'actions.resume': 'Resume',
  'actions.setMode': 'Set mode',
  'actions.setCurrentWp': 'Set current WP',
  'actions.guidedGoto': 'Go here',
  'actions.guidedChangeAlt': 'Change altitude',
  'actions.changeSpeed': 'Change speed',
  'actions.setRoi': 'Set ROI',
  'actions.clearRoi': 'Clear ROI',
  'actions.restartMission': 'Restart mission',
  'actions.emergencyStop': 'Emergency stop',

  // Mode picker.
  'actions.mode.label': 'Flight mode',
  'actions.mode.apply': 'Apply mode',
  'actions.mode.placeholder': 'Select mode…',

  // Prompts (numeric argument capture).
  'actions.prompt.takeoffAlt': 'Takeoff altitude (m):',
  'actions.prompt.changeAlt': 'New altitude (m):',
  'actions.prompt.changeSpeed': 'New ground speed (m/s):',
  'actions.prompt.setCurrentWp': 'Waypoint sequence:',

  // Audit summaries (with args).
  'actions.summary.takeoff': 'Takeoff to {alt} m',
  'actions.summary.setMode': 'Set mode {mode}',
  'actions.summary.setCurrentWp': 'Set current waypoint {seq}',
  'actions.summary.goto': 'Go to {lat}, {lon} @ {alt} m',
  'actions.summary.changeAlt': 'Change altitude to {alt} m',
  'actions.summary.changeSpeed': 'Change speed to {speed} m/s',
  'actions.summary.setRoi': 'Set ROI at {lat}, {lon}',

  // Confirm dialog copy.
  'actions.confirm.title': 'Confirm: {action}',
  'actions.confirm.generic.body': 'Send "{action}" to the vehicle?',
  'actions.confirm.arm.body': 'Arm the vehicle? Propellers/motors may spin.',
  'actions.confirm.disarm.body': 'Disarm the vehicle?',
  'actions.confirm.takeoff.body': 'Command an automatic takeoff?',
  'actions.confirm.land.body': 'Command the vehicle to land?',
  'actions.confirm.rtl.body': 'Return to launch now?',
  'actions.confirm.mode.body': 'Change the flight mode? ({summary})',
  'actions.confirm.auto.body': 'Start the mission (AUTO mode)?',
  'actions.confirm.pause.body': 'Pause the current mission/flight?',
  'actions.confirm.resume.body': 'Resume the current mission/flight?',
  'actions.confirm.setCurrentWp.body': 'Jump the active mission? ({summary})',
  'actions.confirm.goto.body': 'Fly to the selected location? ({summary})',
  'actions.confirm.changeAlt.body': 'Change to the new altitude? ({summary})',
  'actions.confirm.changeSpeed.body': 'Change the vehicle speed? ({summary})',
  'actions.confirm.restartMission.body': 'Restart the mission from the first waypoint?',
  'actions.confirm.emergencyStop.body': 'EMERGENCY STOP — cut motors immediately?',

  'actions.error': '{action} failed: {message}',
};

/** English `audit.*` strings contributed by the audit-log viewer. */
export const AUDIT_MESSAGES: Readonly<Record<string, string>> = {
  'audit.title': 'Action audit log',
  'audit.region.label': 'Action audit log',
  'audit.empty': 'No actions recorded yet',
  'audit.clear': 'Clear log',
  'audit.export.json': 'Export JSON',
  'audit.export.text': 'Export text',
  'audit.col.time': 'Time',
  'audit.col.kind': 'Kind',
  'audit.col.status': 'Status',
  'audit.col.origin': 'Origin',
  'audit.col.summary': 'Action',
  'audit.col.result': 'Result',
  'audit.row.label': '{summary} — {status} ({origin})',

  'audit.status.pending': 'Pending',
  'audit.status.ok': 'OK',
  'audit.status.error': 'Error',
  'audit.status.cancelled': 'Cancelled',

  'audit.kind.command': 'Command',
  'audit.kind.param-set': 'Param set',
  'audit.kind.mission-write': 'Mission write',
};

let registered = false;

/** Register the `actions.*` + `audit.*` English catalogs once (idempotent). */
export function registerActionsMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(ACTIONS_MESSAGES);
  registerMessages(AUDIT_MESSAGES);
}

registerActionsMessages();
