/**
 * i18n registration for the waypoint table (task T4.3; spec plan/04 §4.3,
 * conventions plan/implementation/00 §0.3).
 *
 * Contributes the `plan.table.*` namespace to the English catalog via the public
 * {@link registerMessages} seam — never editing the i18n internals. Registration
 * runs once at import and is idempotent. Altitude-frame labels (`mission.frame.*`)
 * are owned by the command-editor widget and reused here.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `plan.table.*` strings owned by the waypoint table. */
export const WP_TABLE_MESSAGES: Readonly<Record<string, string>> = {
  'plan.table.title': 'Waypoints',
  'plan.table.region.label': 'Waypoint table',
  'plan.table.empty': 'No waypoints yet. Use Add waypoint or click the map to begin.',

  // Column headers.
  'plan.table.col.seq': '#',
  'plan.table.col.command': 'Command',
  'plan.table.col.frame': 'Frame',
  'plan.table.col.lat': 'Latitude',
  'plan.table.col.lon': 'Longitude',
  'plan.table.col.alt': 'Altitude',
  'plan.table.col.current': 'Current',
  'plan.table.col.actions': 'Actions',

  // Per-cell accessible labels (with 1-based sequence).
  'plan.table.cell.frame': 'Altitude frame for waypoint {seq}',
  'plan.table.cell.lat': 'Latitude for waypoint {seq}',
  'plan.table.cell.lon': 'Longitude for waypoint {seq}',
  'plan.table.cell.alt': 'Altitude for waypoint {seq}',
  'plan.table.cell.current': 'Set waypoint {seq} as current',

  // Toolbar / row actions.
  'plan.table.action.add': 'Add waypoint',
  'plan.table.action.insert': 'Insert waypoint after {seq}',
  'plan.table.action.delete': 'Delete waypoint {seq}',
  'plan.table.action.up': 'Move waypoint {seq} up',
  'plan.table.action.down': 'Move waypoint {seq} down',
  'plan.table.action.expand': 'Toggle parameters for waypoint {seq}',
  'plan.table.action.undo': 'Undo',
  'plan.table.action.redo': 'Redo',
  'plan.table.defaultAlt': 'Default altitude',

  // Totals.
  'plan.table.total.distance': 'Distance',
  'plan.table.total.time': 'Time',
  'plan.table.total.waypoints': 'Waypoints',
};

let registered = false;

/** Register the `plan.table.*` English catalog once (idempotent). */
export function registerWpTableMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(WP_TABLE_MESSAGES);
}

registerWpTableMessages();
