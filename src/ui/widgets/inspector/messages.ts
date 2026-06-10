/**
 * MAVLink inspector i18n strings (task T1.12; conventions
 * plan/implementation/00 §0.3, spec plan/05 §5.9). The widget owns its
 * `inspector.*` keys and contributes them at IMPORT TIME via the public
 * {@link registerMessages} seam — no edit to the central English catalog or
 * the i18n internals. The barrel and `register.ts` import this module for its
 * side effect so the keys exist before any mount.
 */
import { registerMessages } from '../../../core/i18n';

/** The shipped English `inspector.*` strings. */
export const INSPECTOR_MESSAGES: Readonly<Record<string, string>> = {
  'inspector.title': 'MAVLink Inspector',
  'inspector.open': 'Open MAVLink Inspector',
  'inspector.closeWindow': 'Close inspector window',
  'inspector.system': 'System',
  'inspector.systemOption': 'System {sysid} · Comp {compid}',
  'inspector.search': 'Search messages',
  'inspector.searchPlaceholder': 'Filter by name or id…',
  'inspector.messages': 'Messages',
  'inspector.empty': 'No MAVLink traffic yet.',
  'inspector.noMatches': 'No messages match the filter.',
  'inspector.expand': 'Expand message fields',
  'inspector.collapse': 'Collapse message fields',
  'inspector.hz': '{n} Hz',
  'inspector.ageMs': '{n} ms ago',
  'inspector.ageS': '{n} s ago',
  'inspector.noFields': 'No fields',
  'inspector.selectHint': 'Select a message to view its raw frame.',
  'inspector.detailFor': 'Details for {name}',
  'inspector.crc': 'CRC',
  'inspector.crcOk': 'Valid',
  'inspector.crcBad': 'Invalid',
  'inspector.signing': 'Signing',
  'inspector.signedLink': 'Signed (link {link})',
  'inspector.unsigned': 'Unsigned',
  'inspector.seq': 'Seq',
  'inspector.count': 'Count',
  'inspector.hexView': 'Raw frame (hex)',
  'inspector.hexLabel': 'Raw hex bytes of the latest {name} frame',
};

registerMessages(INSPECTOR_MESSAGES);
