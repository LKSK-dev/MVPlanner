/**
 * Reactive store + app state seam (impl 02 §2.5; spec plan/02 §2.1). FROZEN.
 */
import type { ConnState } from './transport';
import type { VehicleState } from './vehicle';

export type ScreenId = 'flight' | 'plan' | 'setup' | 'config' | 'logs' | 'sim';

export type UnitSystem = 'metric' | 'imperial';
export type CoordinateFormat = 'dd' | 'dms' | 'utm' | 'mgrs';
export type ThemeId = 'dark' | 'light' | 'high-contrast' | 'field';

/**
 * User-configured basemap tile source (spec plan/04 §4.5 “map source/keys”,
 * plan/07 §7.7). Added T3.7 (additive). The `apiKey` is a local secret: it is
 * stored locally and only ever sent to the configured provider, and is redacted
 * from setting exports by default (spec plan/07 §7.7).
 */
export interface MapSourceSetting {
  /** XYZ/WMS URL template, e.g. `https://tiles.example/{z}/{x}/{y}.png`. */
  urlTemplate: string;
  /** Optional provider API key (local secret; never transmitted elsewhere). */
  apiKey?: string;
}

/** Theme mode: a concrete theme id, or 'system' to follow `prefers-*`. */
export type ThemeMode = ThemeId | 'system';

/** UI density (spacing scale). Added with the App Settings pane (contracts 1.5.0). */
export type Density = 'comfortable' | 'compact';

/** Canonical palette token a custom-color override targets. */
export type AppearanceColorKey = 'accent' | 'text' | 'surface' | 'error' | 'warn' | 'outline';

/**
 * Stored theme bundle (the appearance payload of an installed/exported theme).
 * Structural mirror of the theme module's bundle, kept here so the store can
 * persist a theme library without a contract↔theme import cycle.
 */
export interface StoredThemeBundle {
  themeMode?: ThemeMode;
  colors?: Partial<Record<AppearanceColorKey, string>>;
  density?: Density;
}

/** A user-installed custom theme in the appearance theme library. */
export interface InstalledTheme {
  /** Stable id (selected via {@link AppearanceSettings.activeThemeId}). */
  readonly id: string;
  /** Display name shown in the theme selector + manager. */
  readonly name: string;
  /** The appearance payload applied when this theme is active. */
  readonly bundle: StoredThemeBundle;
}

/**
 * Per-quantity unit overrides (App Settings → Units, contracts 1.6.0). Each is
 * optional; an absent quantity derives from the {@link AppSettings.units} preset.
 */
export interface UnitPreferences {
  altitude?: 'm' | 'ft';
  distance?: 'm' | 'km' | 'ft' | 'mi' | 'nm';
  speed?: 'm/s' | 'km/h' | 'kt' | 'mph';
  verticalSpeed?: 'm/s' | 'ft/min';
  temperature?: 'C' | 'F';
  coordinate?: CoordinateFormat;
  heading?: 'deg' | 'mil';
}

/**
 * Appearance customization for the App Settings pane (contracts 1.5.0,
 * additive). All fields optional; absent fields fall back to code defaults and
 * to {@link AppSettings.theme}. Color override values are validated as CSS
 * colors before being applied as inline custom properties.
 */
export interface AppearanceSettings {
  /** Base theme, or 'system' to follow OS `prefers-*` (overrides `theme`). */
  themeMode?: ThemeMode;
  /** Canonical token color overrides (validated hex/rgb/hsl strings). */
  colors?: Partial<Record<AppearanceColorKey, string>>;
  /** UI density. Defaults to 'comfortable'. */
  density?: Density;
  /** Last-open App Settings section id (UI memory). */
  lastSettingsSection?: string;
  /** Installed custom themes (App Settings → Appearance). 1.6.0. */
  themeLibrary?: InstalledTheme[];
  /** When set + present in {@link themeLibrary}, the active installed theme. 1.6.0. */
  activeThemeId?: string;
}

/**
 * App settings (spec plan/04 §4.5, plan/05 §5.4). Extended (not replaced) at
 * T3.7: the original six fields are required; T3.7 added the optional `mapSource`
 * and `telemetryRateHz` fields (additive — contracts 1.3.0). The App Settings
 * pane added optional `appearance` + `keybinds` (additive — contracts 1.5.0).
 * New fields are optional so persisted/older state and existing defaults remain
 * valid.
 */
export interface AppSettings {
  units: UnitSystem;
  coordinateFormat: CoordinateFormat;
  theme: ThemeId;
  language: string;
  audioAlerts: boolean;
  confirmDestructive: boolean;
  /** Custom basemap tile source + optional key (spec plan/04 §4.5). Added T3.7. */
  mapSource?: MapSourceSetting;
  /**
   * Default telemetry stream-rate profile in Hz (spec plan/04 §4.5). Drives the
   * adaptive stream-rate requests (T1.11). Optional: when unset the stream
   * manager keeps its built-in default. Added T3.7.
   */
  telemetryRateHz?: number;
  /** Appearance customization (theme mode, custom colors, density). 1.5.0. */
  appearance?: AppearanceSettings;
  /** Command id → key-chord override (e.g. `app.settings.open` → `shift+s`). 1.5.0. */
  keybinds?: Record<string, string>;
  /** Per-quantity unit overrides (else derived from {@link units}). 1.6.0. */
  unitPreferences?: UnitPreferences;
}

/** Dock layout + workspaces (spec plan/05 §5.3). Concrete dock shape fixed at T0.7. */
export interface LayoutState {
  activeScreen: ScreenId;
  workspaces: Record<string, unknown>;
}

export interface AppState {
  connection: ConnState;
  vehicles: Record<number, VehicleState>;
  activeSysid?: number;
  settings: AppSettings;
  layout: LayoutState;
}

/** Reactive accessor (Solid signal). */
export type Accessor<T> = () => T;

export interface Store<T> {
  get(): T;
  select<R>(sel: (s: T) => R): Accessor<R>;
  /** Coalesced; applied on the main thread (spec plan/02 §2.6). */
  patch(updater: (draft: T) => void): void;
}
