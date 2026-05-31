/**
 * Default application state + pure merge helpers (impl 03 T0.5; spec plan/02
 * §2.1, plan/07 §7.2). This file is intentionally browser-free and free of any
 * reactive runtime so the state shape and merge rules can be unit-tested in
 * isolation from Solid's reactivity (conventions plan/implementation/00 §0.3).
 */
import type { AppSettings, AppState, LayoutState } from '../../contracts';

/** Default {@link AppSettings} (spec plan/04 §4.5; finalized/extended at T3.7). */
const DEFAULT_APP_SETTINGS: AppSettings = {
  units: 'metric',
  coordinateFormat: 'dd',
  theme: 'dark',
  language: 'en',
  audioAlerts: true,
  confirmDestructive: true,
};

/** Default {@link LayoutState}; concrete dock/workspace shape is fixed at T0.7. */
const DEFAULT_LAYOUT: LayoutState = {
  activeScreen: 'flight',
  workspaces: {},
};

/**
 * Build a fresh {@link AppState} populated with the documented defaults. A new
 * object graph is returned on every call so independent stores never share
 * mutable nested references (Solid's `createStore` mutates in place).
 */
export function createDefaultAppState(): AppState {
  return {
    connection: { kind: 'closed' },
    vehicles: {},
    settings: { ...DEFAULT_APP_SETTINGS },
    layout: { activeScreen: DEFAULT_LAYOUT.activeScreen, workspaces: {} },
  };
}

/**
 * Merge a caller-supplied partial state over {@link createDefaultAppState}.
 * Top-level keys are shallow-overridden; `settings`, `layout` and `vehicles`
 * are merged one level deep so a caller may override a subset without dropping
 * the remaining defaults. Returns a brand-new, non-reactive object.
 */
export function mergeAppState(initial?: Partial<AppState>): AppState {
  const base = createDefaultAppState();
  if (!initial) return base;
  return {
    ...base,
    ...initial,
    settings: { ...base.settings, ...(initial.settings ?? {}) },
    layout: { ...base.layout, ...(initial.layout ?? {}) },
    vehicles: { ...base.vehicles, ...(initial.vehicles ?? {}) },
  };
}
