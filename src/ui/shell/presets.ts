/**
 * Widget catalog helpers for the dockable workspace (UI remake, 1.7.0). Pure +
 * registry-shape-only: turns the registered {@link PanelDef}s into the grouped
 * "Add widget" palette model. Built-in per-screen preset trees are assembled in
 * a later phase once the widgets are registered.
 */
import type { PanelDef } from '../../contracts';

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
