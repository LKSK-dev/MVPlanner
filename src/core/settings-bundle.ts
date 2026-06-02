/**
 * Portable settings bundle (spec docs/appsettings §5.7/§8): serialize the
 * app-wide {@link AppSettings} to a `.mvpsettings.json` the user can keep next to
 * the HTML and re-import (the supported way to carry settings across machines or
 * storage resets). Secrets (the map API key) are redacted from exports. Import
 * is parsed defensively and returns a sanitized patch to merge into the store.
 *
 * Pure + DOM-free; unit-tested.
 */
import type { AppSettings } from '../contracts';

/** Bundle envelope written to disk. */
export interface SettingsBundle {
  readonly kind: 'mvplanner-settings';
  readonly version: 1;
  readonly settings: Partial<AppSettings>;
}

/** Known top-level setting keys we (de)serialize. */
const SCALAR_KEYS = ['units', 'coordinateFormat', 'theme', 'language'] as const;
const BOOL_KEYS = ['audioAlerts', 'confirmDestructive'] as const;

/**
 * Serialize settings to a bundle JSON string, **redacting** the map API key
 * (the URL template is kept; secrets never leave in exports).
 */
export function serializeSettings(settings: AppSettings): string {
  const out: Partial<AppSettings> = {};
  for (const k of SCALAR_KEYS) out[k] = settings[k] as never;
  for (const k of BOOL_KEYS) out[k] = settings[k] as never;
  if (settings.telemetryRateHz !== undefined) out.telemetryRateHz = settings.telemetryRateHz;
  if (settings.appearance !== undefined) out.appearance = settings.appearance;
  if (settings.keybinds !== undefined) out.keybinds = settings.keybinds;
  if (settings.mapSource !== undefined) {
    // Redact the secret; keep the URL template.
    out.mapSource = { urlTemplate: settings.mapSource.urlTemplate };
  }
  const bundle: SettingsBundle = { kind: 'mvplanner-settings', version: 1, settings: out };
  return JSON.stringify(bundle, null, 2);
}

/**
 * Parse + validate a settings bundle into a sanitized {@link AppSettings} patch
 * to merge over the live settings, or `undefined` when the input is not a valid
 * MVPlanner settings bundle. Unknown keys are dropped; types checked leniently.
 */
export function parseSettingsBundle(json: string): Partial<AppSettings> | undefined {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const obj = data as Record<string, unknown>;
  if (obj['kind'] !== 'mvplanner-settings') return undefined;
  const s = obj['settings'];
  if (typeof s !== 'object' || s === null) return undefined;
  const src = s as Record<string, unknown>;

  const out: Partial<AppSettings> = {};
  if (src['units'] === 'metric' || src['units'] === 'imperial') out.units = src['units'];
  if (['dd', 'dms', 'utm', 'mgrs'].includes(String(src['coordinateFormat']))) {
    out.coordinateFormat = src['coordinateFormat'] as AppSettings['coordinateFormat'];
  }
  if (['dark', 'light', 'high-contrast', 'field'].includes(String(src['theme']))) {
    out.theme = src['theme'] as AppSettings['theme'];
  }
  if (typeof src['language'] === 'string') out.language = src['language'];
  if (typeof src['audioAlerts'] === 'boolean') out.audioAlerts = src['audioAlerts'];
  if (typeof src['confirmDestructive'] === 'boolean')
    out.confirmDestructive = src['confirmDestructive'];
  if (typeof src['telemetryRateHz'] === 'number' && src['telemetryRateHz'] > 0) {
    out.telemetryRateHz = src['telemetryRateHz'];
  }
  if (typeof src['appearance'] === 'object' && src['appearance'] !== null) {
    out.appearance = src['appearance'] as NonNullable<AppSettings['appearance']>;
  }
  if (typeof src['keybinds'] === 'object' && src['keybinds'] !== null) {
    const kb: Record<string, string> = {};
    for (const [id, chord] of Object.entries(src['keybinds'] as Record<string, unknown>)) {
      if (typeof chord === 'string') kb[id] = chord;
    }
    out.keybinds = kb;
  }
  const map = src['mapSource'];
  if (typeof map === 'object' && map !== null) {
    const url = (map as Record<string, unknown>)['urlTemplate'];
    if (typeof url === 'string') out.mapSource = { urlTemplate: url };
  }
  return out;
}
