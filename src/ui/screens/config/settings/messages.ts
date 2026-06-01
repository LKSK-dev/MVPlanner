/**
 * i18n registration for the App Settings screen (task T3.7; spec plan/04 §4.5
 * planner/app settings, plan/05 §5.4 Settings, conventions
 * plan/implementation/00 §0.3).
 *
 * Contributes the `settings.*` namespace (the settings editor chrome + the
 * Storage Manager) to the English catalog via the public {@link registerMessages}
 * seam — never editing the i18n internals. Registration runs once at import and
 * is idempotent; the screen barrel imports this for its side effect.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `settings.*` strings contributed by the Settings screen. */
export const SETTINGS_MESSAGES: Readonly<Record<string, string>> = {
  'settings.region.label': 'Settings',

  // Sections.
  'settings.section.general': 'General',
  'settings.section.map': 'Map source',
  'settings.section.telemetry': 'Telemetry',
  'settings.section.preview': 'Preview',
  'settings.section.storage': 'Storage manager',

  // General controls.
  'settings.units.label': 'Units',
  'settings.units.metric': 'Metric',
  'settings.units.imperial': 'Imperial',
  'settings.coord.label': 'Coordinate format',
  'settings.coord.dd': 'Decimal degrees',
  'settings.coord.dms': 'Degrees / minutes / seconds',
  'settings.coord.utm': 'UTM',
  'settings.coord.mgrs': 'MGRS',
  'settings.theme.label': 'Theme',
  'settings.theme.dark': 'Dark',
  'settings.theme.light': 'Light',
  'settings.theme.high-contrast': 'High contrast',
  'settings.theme.field': 'Field',
  'settings.language.label': 'Language',
  'settings.audio.label': 'Audio alerts',
  'settings.confirm.label': 'Confirm destructive actions',

  // Map source.
  'settings.map.url.label': 'Tile URL template',
  'settings.map.url.placeholder': 'https://tiles.example/{z}/{x}/{y}.png',
  'settings.map.key.label': 'Provider API key (optional)',
  'settings.map.key.hint': 'Stored locally; only ever sent to the configured provider.',

  // Telemetry.
  'settings.telemetry.rate.label': 'Default telemetry rate (Hz)',
  'settings.telemetry.rate.hint': 'Leave blank to use the built-in adaptive default.',

  // Preview.
  'settings.preview.coord': 'Coordinate',
  'settings.preview.altitude': 'Altitude',
  'settings.preview.distance': 'Distance',
  'settings.preview.speed': 'Speed',

  // Storage manager.
  'settings.storage.usage.label': 'Storage used',
  'settings.storage.usage.value': '{used} of {quota}',
  'settings.storage.usage.unknown': 'Usage estimate unavailable',
  'settings.storage.namespaces.label': 'By category',
  'settings.storage.namespace.row': '{ns}',
  'settings.storage.namespace.detail': '{size} · {count} items',
  'settings.storage.empty': 'No stored data',
  'settings.storage.refresh': 'Refresh',
  'settings.storage.clearTiles': 'Clear tile cache',
  'settings.storage.clearAll': 'Clear all data…',
  'settings.storage.export': 'Export settings',
  'settings.storage.clearAll.confirm.title': 'Clear all local data?',
  'settings.storage.clearAll.confirm.body':
    'This factory reset permanently deletes all locally stored data (settings, layouts, missions, parameters, logs and cached tiles). This cannot be undone.',
  'settings.storage.unavailable': 'Storage management is unavailable in this context.',
};

let registered = false;

/** Register the `settings.*` English catalog once (idempotent). */
export function registerSettingsMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(SETTINGS_MESSAGES);
}

registerSettingsMessages();
