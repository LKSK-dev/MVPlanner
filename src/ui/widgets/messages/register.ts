/**
 * i18n registration for the STATUSTEXT messages console (task T2.8; conventions
 * plan/implementation/00 §0.3, spec plan/05 §5.9).
 *
 * Contributes the `statustext.*` namespace to the English catalog via the public
 * {@link registerMessages} seam (never edits the i18n internals). Registration
 * runs once at module import and is idempotent; the widget barrel imports this
 * module for its side effect so consumers get the strings for free.
 */
import { registerMessages } from '../../../core/i18n';

/** The English `statustext.*` catalog contributed by this widget. */
export const STATUSTEXT_MESSAGES: Readonly<Record<string, string>> = {
  'statustext.title': 'Messages',
  'statustext.log.label': 'Vehicle status messages',
  'statustext.alerts.label': 'Critical alerts',
  'statustext.empty': 'No messages',
  'statustext.empty.filtered': 'No messages match the filter',
  'statustext.clear': 'Clear messages',
  'statustext.filter.label': 'Minimum severity',
  'statustext.filter.all': 'All',
  'statustext.filter.warn': 'Warnings & errors',
  'statustext.filter.error': 'Errors only',
  'statustext.row.label': '{severity} from {sysid}/{compid} at {time}: {text}',
  'statustext.time': '{time}',

  // Full MAV_SEVERITY level names (non-color text cue, spec §5.8).
  'statustext.severity.emergency': 'EMERGENCY',
  'statustext.severity.alert': 'ALERT',
  'statustext.severity.critical': 'CRITICAL',
  'statustext.severity.error': 'ERROR',
  'statustext.severity.warning': 'WARNING',
  'statustext.severity.notice': 'NOTICE',
  'statustext.severity.info': 'INFO',
  'statustext.severity.debug': 'DEBUG',
};

let registered = false;

/** Register the `statustext.*` English catalog once (idempotent). */
export function registerStatusTextMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(STATUSTEXT_MESSAGES);
}

registerStatusTextMessages();
