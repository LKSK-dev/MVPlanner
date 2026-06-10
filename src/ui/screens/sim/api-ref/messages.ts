/** i18n registration for the extension API reference (task T7.5). */
import { registerMessages } from '../../../../core/i18n';

/** English `apiref.*` messages contributed by the API reference panel. */
export const API_REFERENCE_MESSAGES: Readonly<Record<string, string>> = {
  'apiref.title': 'Extension API Reference',
  'apiref.description':
    'Browse the public ctx / mvp extension API, signatures and required permissions.',
  'apiref.search.label': 'Search API members',
  'apiref.search.placeholder': 'Search methods, permissions or descriptions…',
  'apiref.empty': 'No API members match the filter.',
  'apiref.permission': 'Required permission',
  'apiref.permission.none': 'None',
  'apiref.permission.unlisted': 'Not listed',
  'apiref.copy': 'Copy signature',
  'apiref.copy.done': 'Copied',
  'apiref.copy.failed': 'Copy failed',
  'apiref.command.open': 'Open Extension API Reference',
  'apiref.openHint': 'Dock the Extension API Reference panel from the workspace panel list.',
  'apiref.group.connection': 'Connection',
  'apiref.group.vehicles': 'Vehicles',
  'apiref.group.mavlink': 'MAVLink',
  'apiref.group.command': 'Commands',
  'apiref.group.params': 'Parameters',
  'apiref.group.mission': 'Mission',
  'apiref.group.ui': 'UI',
  'apiref.group.map': 'Map',
  'apiref.group.storage': 'Storage',
  'apiref.group.files': 'Files',
  'apiref.group.net': 'Networking',
  'apiref.group.notify': 'Notifications',
  'apiref.group.log': 'Logs',
  'apiref.group.timers': 'Timers',
  'apiref.group.events': 'Events',
  'apiref.group.theme': 'Theme',
  'apiref.group.transports': 'Transports',
  'apiref.group.lifecycle': 'Lifecycle',
};

let registered = false;

/** Register the `apiref.*` English catalog once (idempotent). */
export function registerApiReferenceMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(API_REFERENCE_MESSAGES);
}

registerApiReferenceMessages();
