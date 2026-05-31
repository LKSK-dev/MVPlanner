/**
 * Reactive store + app state seam (impl 02 §2.5; spec plan/02 §2.1). FROZEN.
 */
import type { ConnState } from './transport';
import type { VehicleState } from './vehicle';

export type ScreenId = 'flight' | 'plan' | 'setup' | 'config' | 'logs' | 'sim';

export type UnitSystem = 'metric' | 'imperial';
export type CoordinateFormat = 'dd' | 'dms' | 'utm' | 'mgrs';
export type ThemeId = 'dark' | 'light' | 'high-contrast' | 'field';

/** App settings (spec plan/04 §4.5, plan/05 §5.4). Extended (not replaced) at T3.7. */
export interface AppSettings {
  units: UnitSystem;
  coordinateFormat: CoordinateFormat;
  theme: ThemeId;
  language: string;
  audioAlerts: boolean;
  confirmDestructive: boolean;
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
