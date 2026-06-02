/**
 * App Settings pane i18n (spec docs/appsettings §9). Contributed at import time
 * via {@link registerMessages}. Covers the pane shell + every section so section
 * components only consume keys (no shared-file edits).
 */
import { registerMessages } from '../../../core/i18n';

/** Shipped English `appsettings.*` strings. */
export const APPSETTINGS_MESSAGES: Readonly<Record<string, string>> = {
  // Pane shell
  'appsettings.title': 'Application Settings',
  'appsettings.open': 'Open application settings',
  'appsettings.close': 'Close application settings',

  // Section labels
  'appsettings.section.recents': 'Recents',
  'appsettings.section.appearance': 'Appearance',
  'appsettings.section.units': 'Units & Measurement',
  'appsettings.section.keybinds': 'Keybinds',
  'appsettings.section.language': 'Language',
  'appsettings.section.maps': 'Maps',
  'appsettings.section.general': 'General',
  'appsettings.section.about': 'About',

  // Recents
  'appsettings.recents.empty': 'No recent files yet. Open a plan, log or parameter file.',
  'appsettings.recents.open': 'Open',
  'appsettings.recents.remove': 'Remove',
  'appsettings.recents.clear': 'Clear recents',
  'appsettings.recents.uncached': 'Content not cached — opening will prompt for the file.',
  'appsettings.recents.kind.plan': 'Plan',
  'appsettings.recents.kind.log': 'Log',
  'appsettings.recents.kind.tlog': 'Telemetry log',
  'appsettings.recents.kind.param': 'Parameters',

  // Appearance
  'appsettings.appearance.theme': 'Theme',
  'appsettings.appearance.theme.system': 'System (auto)',
  'appsettings.appearance.theme.dark': 'Dark',
  'appsettings.appearance.theme.light': 'Light',
  'appsettings.appearance.theme.high-contrast': 'High contrast',
  'appsettings.appearance.theme.field': 'Field (sunlight)',
  'appsettings.appearance.density': 'Density',
  'appsettings.appearance.density.comfortable': 'Comfortable',
  'appsettings.appearance.density.compact': 'Compact',
  'appsettings.appearance.colors': 'Custom colors',
  'appsettings.appearance.color.accent': 'Accent',
  'appsettings.appearance.color.text': 'Text',
  'appsettings.appearance.color.surface': 'Surface',
  'appsettings.appearance.color.error': 'Error',
  'appsettings.appearance.color.warn': 'Warning',
  'appsettings.appearance.color.invalid': 'Not a valid color',
  'appsettings.appearance.resetColors': 'Reset colors',
  'appsettings.appearance.importTheme': 'Import theme…',
  'appsettings.appearance.exportTheme': 'Export theme',
  'appsettings.appearance.importError': 'That file is not a valid MVPlanner theme.',
  'appsettings.appearance.layout': 'Layout',
  'appsettings.appearance.saveWorkspace': 'Save current layout',
  'appsettings.appearance.resetLayout': 'Reset to default layout',

  // Units & Measurement
  'appsettings.units.system': 'Unit system',
  'appsettings.units.metric': 'Metric',
  'appsettings.units.imperial': 'Imperial',
  'appsettings.units.coord': 'Coordinate format',
  'appsettings.units.coord.dd': 'Decimal degrees',
  'appsettings.units.coord.dms': 'Degrees/minutes/seconds',
  'appsettings.units.coord.utm': 'UTM',
  'appsettings.units.coord.mgrs': 'MGRS',
  'appsettings.units.preview': 'Preview',
  'appsettings.units.preview.coord': 'Coordinate',
  'appsettings.units.preview.altitude': 'Altitude',
  'appsettings.units.preview.distance': 'Distance',
  'appsettings.units.preview.speed': 'Speed',

  // Keybinds
  'appsettings.keybinds.intro': 'Click a shortcut to rebind it. Press Escape to cancel.',
  'appsettings.keybinds.press': 'Press a key…',
  'appsettings.keybinds.unbound': 'Unbound',
  'appsettings.keybinds.reset': 'Reset',
  'appsettings.keybinds.resetAll': 'Reset all',
  'appsettings.keybinds.conflict': 'Already bound to “{command}”.',
  'appsettings.keybinds.rebind': 'Rebind {command}',

  // Language
  'appsettings.language.label': 'Display language',

  // Maps
  'appsettings.maps.preset.label': 'Basemap',
  'appsettings.maps.preset.cartoDark': 'CARTO Dark',
  'appsettings.maps.preset.cartoLight': 'CARTO Light',
  'appsettings.maps.preset.osm': 'OpenStreetMap',
  'appsettings.maps.preset.esriSatellite': 'Esri World Imagery (satellite)',
  'appsettings.maps.preset.custom': 'Custom…',
  'appsettings.maps.url': 'Tile URL template',
  'appsettings.maps.url.placeholder': 'https://tiles.example/{z}/{x}/{y}.png',
  'appsettings.maps.key': 'API key',
  'appsettings.maps.key.hint':
    'Stored locally; only sent to the tile provider; redacted from exports.',
  'appsettings.maps.cache': 'Tile cache',
  'appsettings.maps.clearCache': 'Clear tile cache',

  // General / Advanced
  'appsettings.general.audio': 'Voice & audio alerts',
  'appsettings.general.confirm': 'Confirm destructive actions',
  'appsettings.general.telemetry': 'Default telemetry rate (Hz)',
  'appsettings.general.telemetry.hint': 'Leave blank to use the adaptive default.',
  'appsettings.general.storage': 'Storage',
  'appsettings.general.usage': 'Usage',
  'appsettings.general.usage.unknown': 'Usage unavailable',
  'appsettings.general.usage.value': '{used} of {quota}',
  'appsettings.general.refresh': 'Refresh',
  'appsettings.general.clearTiles': 'Clear tile cache',
  'appsettings.general.factoryReset': 'Factory reset',
  'appsettings.general.factoryReset.confirm.title': 'Erase all local data?',
  'appsettings.general.factoryReset.confirm.body':
    'This clears all settings, caches and stored data. This cannot be undone.',
  'appsettings.general.bundle': 'Settings backup',
  'appsettings.general.exportSettings': 'Export settings…',
  'appsettings.general.importSettings': 'Import settings…',
  'appsettings.general.importError': 'That file is not a valid MVPlanner settings backup.',
  'appsettings.general.persistenceNote':
    'Settings are stored in this browser. When running from a file, keep an exported backup as a safeguard.',

  // About
  'appsettings.about.open': 'Open About',
};

registerMessages(APPSETTINGS_MESSAGES);
