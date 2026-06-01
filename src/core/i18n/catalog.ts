/**
 * Message catalog types + the shipped English catalog (T0.8).
 *
 * A catalog is a flat map of stable message keys to template strings; templates
 * may contain `{var}` placeholders substituted by {@link interpolate}. The
 * English catalog is the source of truth and the fallback for every other
 * locale (spec plan/05 §5.9, conventions plan/implementation/00 §0.3).
 */

/** A flat map of message key → template string with optional `{var}` slots. */
export type MessageCatalog = Readonly<Record<string, string>>;

/** Interpolation variables for {@link interpolate} and `t()`. */
export type MessageVars = Record<string, string | number>;

/**
 * Shipped English catalog (`en`). Keys are stable contracts used by `t()`;
 * values are the user-facing copy. New strings are added here first.
 */
export const EN_MESSAGES: MessageCatalog = {
  'app.name': 'MVPlanner',
  'app.tagline': 'Modern MAVLink Ground Control',
  'nav.flight': 'Flight',
  'nav.plan': 'Plan',
  'nav.setup': 'Setup',
  'nav.config': 'Config',
  'nav.logs': 'Logs',
  'nav.sim': 'Sim',
  'screen.placeholder': '{screen} — coming in a later milestone',
  'conn.disconnected': 'Disconnected',

  // --- T0.7 app-shell keys (additive; consumed by src/ui/shell) ----------
  'shell.brand': 'MVPlanner',
  'conn.closed': 'Disconnected',
  'conn.opening': 'Connecting…',
  'conn.open': 'Connected',
  'conn.reconnecting': 'Reconnecting…',
  'conn.error': 'Link error',
  'status.armed': 'Armed',
  'status.disarmed': 'Disarmed',
  'status.mode': 'Mode',
  'status.battery': 'Battery',
  'status.unknown': '—',
  'a11y.mainNav': 'Primary screens',
  'a11y.statusChips': 'Vehicle status',
  'a11y.notifications': 'Notifications',
  'a11y.screenRegion': '{screen} screen',
  'topbar.openPalette': 'Open command palette',
  'palette.title': 'Command palette',
  'palette.placeholder': 'Type a command or screen…',
  'palette.noResults': 'No matching commands',
  'palette.commands': 'Commands',
  'cmd.goTo': 'Go to {screen}',
  'cmd.saveWorkspace': 'Save current workspace',
  'cmd.openPalette': 'Open command palette',
  'toast.dismiss': 'Dismiss notification',
  'confirm.confirm': 'Confirm',
  'confirm.cancel': 'Cancel',
  'confirm.armedWarning': 'The vehicle is armed — proceed with caution.',
  'cap.serialUnsupported': 'Web Serial is not supported in this browser.',
  'cap.serialUnsupportedDetail':
    'Serial connections to a board or radio are unavailable. Use a supported browser (Chrome/Edge) or the WebSocket bridge.',
  'cap.dismiss': 'Dismiss this notice',
  'dock.resizePanels': 'Resize panels',
  'workspace.default': 'Default',

  // --- T1.10 connection drawer + diagnostics (additive) ------------------
  'cmd.connection': 'Connect / Disconnect',
  'conn.drawer.title': 'Connection',
  'conn.drawer.close': 'Close connection panel',
  'conn.transport': 'Transport',
  'conn.transport.unsupported': 'Not supported in this browser',
  'conn.connect': 'Connect',
  'conn.connecting': 'Connecting\u2026',
  'conn.disconnect': 'Disconnect',
  'conn.error.title': 'Connection error',
  'conn.vehicles': 'Vehicles',
  'conn.vehicle.active': 'Active vehicle',
  'conn.vehicle.label': 'System {sysid} \u2014 {mode}',
  'conn.noVehicles': 'No vehicles detected',
  'conn.diagnostics': 'Link diagnostics',
  'conn.diag.rate': 'Rate',
  'conn.diag.loss': 'Loss',
  'conn.diag.rssi': 'RSSI',
  'conn.diag.signed': 'Signed',
  'conn.diag.bytesIn': 'Bytes in',
  'conn.diag.bytesOut': 'Bytes out',
  'conn.diag.packets': 'Packets',
  'conn.yes': 'Yes',
  'conn.no': 'No',
  'transport.name.serial': 'Serial',
  'transport.name.websocket': 'WebSocket bridge',
  'transport.name.replay': 'Replay (tlog)',
  'transport.serial.baudRate': 'Baud rate',
  'transport.websocket.url': 'Bridge URL',
  'transport.websocket.url.placeholder': 'ws://localhost:5760',
  'transport.replay.data': 'tlog file',
  'transport.replay.speed': 'Playback speed',

  // --- T1.12 MAVLink inspector (additive; consumed by ui/widgets/inspector) --
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

/**
 * Substitute `{var}` placeholders in `template` with stringified `vars`.
 * Returns the template unchanged when no vars are supplied.
 */
export function interpolate(template: string, vars?: MessageVars): string {
  if (!vars) return template;
  let s = template;
  for (const [k, v] of Object.entries(vars)) {
    s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}
