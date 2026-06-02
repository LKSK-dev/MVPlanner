/**
 * i18n registration for the MAV_CMD command editor widget (task T4.2;
 * conventions plan/implementation/00 §0.3, spec plan/05 §5.9).
 *
 * Contributes the editor's `cmd.*` and `mission.*` strings to the English
 * catalog via the public {@link registerMessages} seam (never editing i18n
 * internals). Registration runs once at import and is idempotent.
 */
import { registerMessages } from '../../../core/i18n';

/** English `cmd.*` / `mission.*` strings owned by the command editor widget. */
export const CMD_EDITOR_MESSAGES: Readonly<Record<string, string>> = {
  // Editor chrome
  'cmd.editor.label': 'Command editor',
  'cmd.editor.command': 'Command',
  'cmd.editor.frame': 'Altitude frame',
  'cmd.editor.picker': 'Select command',
  'cmd.editor.params': 'Parameters',
  'cmd.editor.position': 'Position',

  // Command picker groups (by category)
  'cmd.group.nav': 'Navigation',
  'cmd.group.do': 'Actions (DO)',
  'cmd.group.condition': 'Conditions',
  'cmd.group.other': 'Other',

  // Custom command entry (arbitrary MAV_CMD id)
  'cmd.custom': 'Custom…',
  'cmd.customPlaceholder': 'MAV_CMD id',

  // Generic slot fallbacks (used when the dialect has no label)
  'cmd.param': 'Param {n}',
  'cmd.slot.lat': 'Latitude',
  'cmd.slot.lon': 'Longitude',
  'cmd.slot.alt': 'Altitude',
  'cmd.slot.unused': 'unused',

  // Altitude frames (shared with the waypoint table T4.3)
  'mission.frame.relative': 'Relative (above home)',
  'mission.frame.amsl': 'Absolute (AMSL)',
  'mission.frame.terrain': 'Terrain',

  // Estimate labels (shared with the waypoint table T4.3)
  'mission.estimate.distance': 'Distance',
  'mission.estimate.time': 'Time',
  'mission.estimate.waypoints': 'Waypoints',
};

let registered = false;

/** Register the command editor's English catalog once (idempotent). */
export function registerCmdEditorMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(CMD_EDITOR_MESSAGES);
}

registerCmdEditorMessages();
