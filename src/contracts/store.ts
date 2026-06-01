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

/**
 * App settings (spec plan/04 §4.5, plan/05 §5.4). Extended (not replaced) at
 * T3.7: the original six fields are required; T3.7 added the optional `mapSource`
 * and `telemetryRateHz` fields (additive — contracts 1.3.0). New fields are
 * optional so persisted/older state and existing defaults remain valid.
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
