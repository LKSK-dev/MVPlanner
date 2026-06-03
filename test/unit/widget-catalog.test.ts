/**
 * Widget catalog helper tests (UI remake Phase 0): only meta-bearing panels are
 * dockable widgets; grouping + sort are stable.
 */
import { describe, expect, it } from 'vitest';
import {
  widgetCatalog,
  groupByCategory,
  DEFAULT_WIDGET_CATEGORY,
} from '../../src/ui/shell/presets';
import type { PanelDef } from '../../src/contracts';

const panel = (id: string, title: string, meta?: PanelDef['meta']): PanelDef => ({
  id,
  title,
  ...(meta !== undefined ? { meta } : {}),
  mount: () => undefined,
});

describe('widgetCatalog', () => {
  it('includes only panels with meta, sorted by category then title', () => {
    const panels: PanelDef[] = [
      panel('screen.flight', 'Flight'), // no meta -> excluded
      panel('widget.hud', 'HUD', { category: 'Flight', singleton: true, icon: '✈' }),
      panel('widget.map', 'Map', { category: 'Flight' }),
      panel('widget.params', 'Parameters', { category: 'Config' }),
      panel('widget.x', 'X', {}), // meta but no category -> Other
    ];
    const cat = widgetCatalog(panels);
    expect(cat.map((c) => c.id)).toEqual(['widget.params', 'widget.hud', 'widget.map', 'widget.x']);
    expect(cat.find((c) => c.id === 'widget.hud')?.singleton).toBe(true);
    expect(cat.find((c) => c.id === 'widget.x')?.category).toBe(DEFAULT_WIDGET_CATEGORY);
  });

  it('groups by category', () => {
    const groups = groupByCategory(
      widgetCatalog([
        panel('widget.hud', 'HUD', { category: 'Flight' }),
        panel('widget.map', 'Map', { category: 'Flight' }),
        panel('widget.params', 'Parameters', { category: 'Config' }),
      ]),
    );
    expect(groups.get('Flight')?.map((e) => e.id)).toEqual(['widget.hud', 'widget.map']);
    expect(groups.get('Config')?.map((e) => e.id)).toEqual(['widget.params']);
  });
});
