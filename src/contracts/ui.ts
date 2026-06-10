/**
 * UI extension-point seams (impl 02 §2.6; spec plan/05 §5.5, plan/06 §6.4). FROZEN.
 */
import type { AppState, Store } from './store';

export interface PanelApi {
  store: Store<AppState>;
  t: (k: string, vars?: Record<string, string | number>) => string;
  /**
   * Per-instance widget settings from the dock layout (1.7.0, optional). A
   * widget reads its persisted config here; absent for non-dock mounts.
   */
  settings?: Readonly<Record<string, unknown>>;
  /** Persist a change to this widget instance's settings (1.7.0, optional). */
  onSettingsChange?: (next: Record<string, unknown>) => void;
}

/** One declarative setting a widget exposes (auto-rendered settings popover). */
export interface WidgetSettingField {
  readonly key: string;
  readonly type: 'boolean' | 'number' | 'text' | 'select';
  readonly label: string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly default?: unknown;
}

/**
 * Optional widget metadata for the dockable workspace (UI remake 1.7.0). Drives
 * the “Add widget” palette, default tiling size, single-instance enforcement and
 * the auto-generated per-widget settings popover. Additive: panels without it
 * still mount.
 */
export interface WidgetMeta {
  /** Glyph/icon for headers + the palette. */
  readonly icon?: string;
  /** Palette grouping (e.g. 'Flight', 'Plan'). */
  readonly category?: string;
  /** At most one instance may exist in a workspace (e.g. the HUD). */
  readonly singleton?: boolean;
  /** Suggested fractional size when first added. */
  readonly defaultSize?: { readonly w?: number; readonly h?: number };
  /** Declarative settings schema (auto-rendered) for this widget. */
  readonly settingsSchema?: readonly WidgetSettingField[];
}

export interface PanelDef {
  id: string;
  title: string;
  icon?: string;
  /** Widget metadata for the dockable workspace (1.7.0, optional). */
  meta?: WidgetMeta;
  /** Returns an optional disposer. */
  mount(el: HTMLElement, api: PanelApi): void | (() => void);
}

export interface CommandDef {
  id: string;
  title: string;
  shortcut?: string;
  run(): void | Promise<void>;
}

/**
 * Canonical safety-confirm function type (the shape of `UiRegistry.confirm`).
 * Import this instead of re-declaring per-module `ConfirmFn` aliases (1.8.0).
 */
export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

export interface ConfirmOptions {
  title: string;
  body: string;
  destructive?: boolean;
  /** Strengthen confirmation when armed/in-air (spec plan/08 §8.3). */
  armedAware?: boolean;
}

export interface UiRegistry {
  registerPanel(def: PanelDef): () => void;
  /** Command palette (spec plan/05 §5.7). */
  registerCommand(def: CommandDef): () => void;
  addMenuItem(location: string, item: CommandDef): () => void;
  toast(kind: 'info' | 'warn' | 'error', msg: string): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
}
