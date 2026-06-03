/**
 * App Settings pane i18n (spec docs/appsettings §9). Contributed at import time
 * via {@link registerMessages}. Covers the pane shell + every section so section
 * components only consume keys (no shared-file edits).
 */
import { registerMessages } from '../../../core/i18n';

/** Shipped English `appsettings.*` strings. */
export const APPSETTINGS_MESSAGES: Readonly<Record<string, string>> = {
  // Pane shell
  'appsettings.title': 'MVPlanner Settings',
  'appsettings.open': 'Open MVPlanner Settings',
  'appsettings.close': 'Close MVPlanner Settings',

  // Section labels
  'appsettings.section.recents': 'Recents',
  'appsettings.section.appearance': 'Appearance',
  'appsettings.section.units': 'Units & Measurement',
  'appsettings.section.keybinds': 'Keybinds',
  'appsettings.section.language': 'Language',
  'appsettings.section.maps': 'Maps',
  'appsettings.section.extensions': 'Extensions',
  'appsettings.section.general': 'General',
  'appsettings.section.about': 'About',

  // Extensions
  'appsettings.extensions.unavailable': 'Extensions are unavailable in this session.',

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
  'appsettings.appearance.color.outline': 'Outline',
  'appsettings.appearance.color.error': 'Error',
  'appsettings.appearance.color.warn': 'Warning',
  'appsettings.appearance.color.invalid': 'Not a valid color',
  'appsettings.appearance.resetColors': 'Reset colors',
  'appsettings.appearance.installTheme': 'Install theme…',
  'appsettings.appearance.exportTheme': 'Export theme',
  'appsettings.appearance.importError': 'That file is not a valid MVPlanner theme.',
  'appsettings.appearance.themeName': 'Theme name',
  'appsettings.appearance.defaultThemeName': 'Custom theme',
  'appsettings.appearance.installedThemes': 'Installed themes',
  'appsettings.appearance.noInstalled': 'No installed themes yet. Install one to add it here.',
  'appsettings.appearance.edit': 'Edit',
  'appsettings.appearance.uninstall': 'Uninstall',
  'appsettings.appearance.saveToTheme': 'Save changes to theme',
  'appsettings.appearance.builtin': 'Built-in (cannot be removed)',
  'appsettings.appearance.themeSaved': 'Theme installed.',
  'appsettings.appearance.layout': 'Layout',
  'appsettings.appearance.saveWorkspace': 'Save current layout',
  'appsettings.appearance.resetLayout': 'Reset to default layout',

  // Windows & layout (dockable workspace)
  'appsettings.layout.title': 'Windows & layout',
  'appsettings.layout.intro':
    'Drag the dividers between panels to resize them. Add or remove widgets and arrange each workspace below; changes are saved automatically.',
  'appsettings.layout.workspace': 'Active workspace',
  'appsettings.layout.resetPreset': 'Reset this workspace to default',
  'appsettings.layout.addWidget': 'Add widget',
  'appsettings.layout.addWidget.placeholder': 'Add a widget…',
  'appsettings.layout.widgets': 'Widgets in this workspace',
  'appsettings.layout.remove': 'Remove',
  'appsettings.layout.empty': 'No widgets.',
  'appsettings.layout.exportLayout': 'Export layout',
  'appsettings.layout.importLayout': 'Import layout',
  'appsettings.layout.importError': 'That file is not a valid MVPlanner layout.',

  // Units & Measurement
  'appsettings.units.system': 'Unit system',
  'appsettings.units.metric': 'Metric',
  'appsettings.units.imperial': 'Imperial',
  'appsettings.units.coord': 'Coordinate format',
  'appsettings.units.coord.dd': 'Decimal degrees',
  'appsettings.units.coord.dms': 'Degrees/minutes/seconds',
  'appsettings.units.coord.utm': 'UTM',
  'appsettings.units.coord.mgrs': 'MGRS',
  'appsettings.units.advanced': 'Per-quantity units',
  'appsettings.units.auto': 'Auto (from preset)',
  'appsettings.units.q.altitude': 'Altitude',
  'appsettings.units.q.distance': 'Distance',
  'appsettings.units.q.speed': 'Speed',
  'appsettings.units.q.verticalSpeed': 'Vertical speed',
  'appsettings.units.q.temperature': 'Temperature',
  'appsettings.units.q.heading': 'Heading',
  'appsettings.units.q.coordinate': 'Coordinates',
  'appsettings.units.unit.m': 'Meters (m)',
  'appsettings.units.unit.ft': 'Feet (ft)',
  'appsettings.units.unit.km': 'Kilometers (km)',
  'appsettings.units.unit.mi': 'Miles (mi)',
  'appsettings.units.unit.nm': 'Nautical miles (nm)',
  'appsettings.units.unit.mps': 'Meters/sec (m/s)',
  'appsettings.units.unit.kmh': 'Kilometers/hour (km/h)',
  'appsettings.units.unit.kt': 'Knots (kt)',
  'appsettings.units.unit.mph': 'Miles/hour (mph)',
  'appsettings.units.unit.ftmin': 'Feet/min (ft/min)',
  'appsettings.units.unit.celsius': 'Celsius (°C)',
  'appsettings.units.unit.fahrenheit': 'Fahrenheit (°F)',
  'appsettings.units.unit.deg': 'Degrees (°)',
  'appsettings.units.unit.mil': 'Mils',
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
  'appsettings.keybinds.manual': 'Type a shortcut for {command}',
  'appsettings.keybinds.manualPlaceholder': 'e.g. Shift+1',
  'appsettings.keybinds.invalid': 'Not a valid shortcut.',

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
