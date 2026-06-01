/**
 * i18n registration for the MAVLink message / command sender widget.
 *
 * Contributes the `msgsender.*` namespace through the public i18n seam. Importing
 * the widget barrel registers these strings once.
 */
import { registerMessages } from '../../../core/i18n';

/** English `msgsender.*` strings owned by this widget. */
export const MSG_SENDER_MESSAGES: Readonly<Record<string, string>> = {
  'msgsender.title': 'MAVLink message sender',
  'msgsender.search': 'Search messages and commands',
  'msgsender.searchPlaceholder': 'HEARTBEAT, COMMAND, MAV_CMD…',
  'msgsender.pick': 'Message or command',
  'msgsender.noChoices': 'No messages or commands match the search.',
  'msgsender.section.fields': 'Fields',
  'msgsender.section.options': 'Send options',
  'msgsender.section.favorites': 'Favorites',
  'msgsender.kind.message': 'Message',
  'msgsender.kind.command': 'MAV_CMD',
  'msgsender.signed': 'Signed',
  'msgsender.unsigned': 'Unsigned',
  'msgsender.commandWire': 'Command wire message',
  'msgsender.commandWire.long': 'v1 / COMMAND_LONG',
  'msgsender.commandWire.int': 'v2 / COMMAND_INT',
  'msgsender.targetSystem': 'Target system',
  'msgsender.targetComponent': 'Target component',
  'msgsender.confirmation': 'Confirmation',
  'msgsender.frame': 'COMMAND_INT frame',
  'msgsender.current': 'COMMAND_INT current',
  'msgsender.autocontinue': 'COMMAND_INT autocontinue',
  'msgsender.send': 'Send',
  'msgsender.sent': 'Sent {name}',
  'msgsender.failed': 'Send failed: {error}',
  'msgsender.units': 'Units: {units}',
  'msgsender.arrayHint': 'Comma-separated ({count} values)',
  'msgsender.favoriteName': 'Favorite name',
  'msgsender.saveFavorite': 'Save favorite',
  'msgsender.applyFavorite': 'Apply favorite',
  'msgsender.noFavorites': 'No favorites saved for this selection.',
  'msgsender.rate.title': 'Request stream rate',
  'msgsender.rate.hz': 'Rate in Hz',
  'msgsender.rate.request': 'Request this message rate',
  'msgsender.rate.sent': 'Requested {name} at {hz} Hz',
};

let registered = false;

/** Register the `msgsender.*` English catalog once (idempotent). */
export function registerMsgSenderMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(MSG_SENDER_MESSAGES);
}

registerMsgSenderMessages();
