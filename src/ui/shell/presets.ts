/**
 * Widget catalog helpers for the dockable workspace (UI remake, 1.7.0). Pure +
 * registry-shape-only: turns the registered {@link PanelDef}s into the grouped
 * "Add widget" palette model. Built-in per-screen preset trees are assembled in
 * a later phase once the widgets are registered.
 */
import type { PanelDef, ScreenId } from '../../contracts';
import { SCREEN_ORDER, screenPanelId } from './screens';
import {
  makePanel,
  SHELL_SCHEMA_VERSION,
  type ShellLayout,
  type ShellWorkspace,
} from './workspace';

/** One selectable widget in the palette. */
export interface WidgetCatalogEntry {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly category: string;
  readonly singleton: boolean;
}

/** Category used when a widget declares no `meta.category`. */
export const DEFAULT_WIDGET_CATEGORY = 'Other';

/**
 * Build the palette catalog from registered panels. Only panels carrying
 * {@link PanelDef.meta} are treated as dockable widgets (screen-assembly panels
 * without meta are excluded). Sorted by category then title.
 */
export function widgetCatalog(panels: readonly PanelDef[]): WidgetCatalogEntry[] {
  const out: WidgetCatalogEntry[] = [];
  for (const def of panels) {
    if (def.meta === undefined) continue;
    out.push({
      id: def.id,
      title: def.title,
      ...(def.icon !== undefined
        ? { icon: def.icon }
        : def.meta.icon !== undefined
          ? { icon: def.meta.icon }
          : {}),
      category: def.meta.category ?? DEFAULT_WIDGET_CATEGORY,
      singleton: def.meta.singleton ?? false,
    });
  }
  return out.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));
}

/** Group catalog entries by category, preserving sorted order. */
export function groupByCategory(
  entries: readonly WidgetCatalogEntry[],
): Map<string, WidgetCatalogEntry[]> {
  const groups = new Map<string, WidgetCatalogEntry[]>();
  for (const entry of entries) {
    const bucket = groups.get(entry.category) ?? [];
    bucket.push(entry);
    groups.set(entry.category, bucket);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Built-in workspace presets (UI remake). Each of the six screens is a named,
// editable workspace whose default root mounts that screen's panel; users tile
// in more widgets, resize, tab, save + reset. Presets ship in code so “Reset to
// preset” always restores them.
// ---------------------------------------------------------------------------

/** A translator for workspace/screen names. */
export type NameFor = (screenId: string) => string;

/** The default (preset) workspace for a screen id. */
export function builtinWorkspace(screenId: ScreenId, name: string): ShellWorkspace {
  return { id: screenId, name, root: makePanel(screenPanelId(screenId), `root-${screenId}`) };
}

/** The full default shell layout: one preset workspace per screen. */
export function defaultLayout(nameFor: NameFor): ShellLayout {
  const workspaces: Record<string, ShellWorkspace> = {};
  for (const id of SCREEN_ORDER) workspaces[id] = builtinWorkspace(id, nameFor(id));
  return {
    schemaVersion: SHELL_SCHEMA_VERSION,
    activeWorkspaceId: SCREEN_ORDER[0] ?? 'flight',
    order: [...SCREEN_ORDER],
    workspaces,
  };
}

/**
 * Ensure every built-in preset workspace exists (adding missing ones) and the
 * active id is valid, preserving user-edited + custom workspaces. Idempotent;
 * run on hydrate after {@link import('./workspace').migrateShellLayout}.
 */
export function ensurePresets(shell: ShellLayout, nameFor: NameFor): ShellLayout {
  const workspaces: Record<string, ShellWorkspace> = { ...shell.workspaces };
  const order = [...shell.order];
  for (const id of SCREEN_ORDER) {
    if (workspaces[id] === undefined) {
      workspaces[id] = builtinWorkspace(id, nameFor(id));
      if (!order.includes(id)) order.push(id);
    }
  }
  const active = workspaces[shell.activeWorkspaceId]
    ? shell.activeWorkspaceId
    : (SCREEN_ORDER[0] ?? 'flight');
  return {
    ...shell,
    schemaVersion: SHELL_SCHEMA_VERSION,
    order,
    workspaces,
    activeWorkspaceId: active,
  };
}

/** Reset a screen's workspace back to its built-in preset. */
export function resetWorkspaceToPreset(
  shell: ShellLayout,
  screenId: string,
  name: string,
): ShellLayout {
  if (!(SCREEN_ORDER as readonly string[]).includes(screenId)) return shell;
  return {
    ...shell,
    workspaces: { ...shell.workspaces, [screenId]: builtinWorkspace(screenId as ScreenId, name) },
  };
}
