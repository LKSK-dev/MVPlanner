/**
 * Dock tree v2 reducer + migration tests (UI remake Phase 0). These pure
 * reducers are the layout engine's foundation, so they get thorough coverage.
 */
import { describe, expect, it } from 'vitest';
import {
  allPanels,
  countPanels,
  equalizeSplit,
  findPanel,
  insertRelative,
  makePanel,
  migrateShellLayout,
  movePanel,
  removePanel,
  setActiveTab,
  widgetIdOf,
  type DockNode,
  type ShellLayout,
  type SplitNode,
  type TabNode,
} from '../../src/ui/shell/workspace';

/** Deterministic id generator for assertions. */
function seqGen(): () => string {
  let n = 0;
  return () => `g${(n += 1)}`;
}

function rowAB(): SplitNode {
  return {
    type: 'split',
    id: 's',
    direction: 'row',
    sizes: [0.5, 0.5],
    children: [makePanel('map', 'A'), makePanel('hud', 'B')],
  };
}

describe('panel helpers', () => {
  it('widgetIdOf prefers widgetId then legacy panelId', () => {
    expect(widgetIdOf(makePanel('map', 'A'))).toBe('map');
    expect(widgetIdOf({ type: 'panel', id: 'L', panelId: 'legacy' })).toBe('legacy');
    expect(widgetIdOf({ type: 'panel', id: 'X' })).toBe('');
  });
  it('allPanels / findPanel / countPanels', () => {
    const root = rowAB();
    expect(allPanels(root).map((p) => p.id)).toEqual(['A', 'B']);
    expect(countPanels(root)).toBe(2);
    expect(findPanel(root, 'B')?.id).toBe('B');
    expect(findPanel(root, 'Z')).toBeUndefined();
  });
});

describe('insertRelative', () => {
  it('center wraps a panel in a tab', () => {
    const out = insertRelative(rowAB(), 'B', makePanel('plot', 'C'), 'center', seqGen());
    const split = out as SplitNode;
    const tab = split.children[1] as TabNode;
    expect(tab.type).toBe('tabs');
    expect(tab.children.map((c) => c.id)).toEqual(['B', 'C']);
    expect(tab.active).toBe(1);
  });
  it('center appends to an existing tab', () => {
    const withTab = insertRelative(rowAB(), 'B', makePanel('plot', 'C'), 'center', seqGen());
    const out = insertRelative(withTab, 'C', makePanel('insp', 'D'), 'center', seqGen());
    const tab = (out as SplitNode).children[1] as TabNode;
    expect(tab.children.map((c) => c.id)).toEqual(['B', 'C', 'D']);
    expect(tab.active).toBe(2);
  });
  it('edge zones wrap the target in a split (order by side)', () => {
    const right = insertRelative(rowAB(), 'B', makePanel('plot', 'C'), 'right', seqGen());
    const inner = (right as SplitNode).children[1] as SplitNode;
    expect(inner.type).toBe('split');
    expect(inner.direction).toBe('row');
    expect(inner.children.map((c) => (c as { id: string }).id)).toEqual(['B', 'C']);
    const top = insertRelative(rowAB(), 'B', makePanel('plot', 'C'), 'top', seqGen());
    const innerT = (top as SplitNode).children[1] as SplitNode;
    expect(innerT.direction).toBe('column');
    expect(innerT.children.map((c) => (c as { id: string }).id)).toEqual(['C', 'B']);
  });
});

describe('removePanel', () => {
  it('collapses a split to its sole survivor + drops it when empty', () => {
    expect(removePanel(rowAB(), 'A')).toEqual(makePanel('hud', 'B'));
    expect(removePanel(makePanel('only', 'O'), 'O')).toBeUndefined();
  });
  it('renormalises sibling sizes', () => {
    const three: SplitNode = {
      type: 'split',
      id: 's',
      direction: 'row',
      sizes: [0.2, 0.3, 0.5],
      children: [makePanel('a', 'A'), makePanel('b', 'B'), makePanel('c', 'C')],
    };
    const out = removePanel(three, 'B') as SplitNode;
    expect(out.children.map((c) => (c as { id: string }).id)).toEqual(['A', 'C']);
    expect(out.sizes[0]).toBeCloseTo(0.2 / 0.7, 5);
    expect(out.sizes[1]).toBeCloseTo(0.5 / 0.7, 5);
  });
  it('collapses a tab to a panel when one child remains', () => {
    const withTab = insertRelative(rowAB(), 'B', makePanel('plot', 'C'), 'center', seqGen());
    const out = removePanel(withTab, 'C') as SplitNode;
    expect(out.children[1]).toEqual(makePanel('hud', 'B'));
  });

  describe('tabs active-index shifting', () => {
    function tabsABCD(): TabNode {
      return {
        type: 'tabs',
        id: 't',
        active: 2,
        children: [
          makePanel('a', 'A'),
          makePanel('b', 'B'),
          makePanel('c', 'C'),
          makePanel('d', 'D'),
        ],
      };
    }
    it('keeps the same tab visible when an earlier tab is removed', () => {
      const out = removePanel(tabsABCD(), 'A') as TabNode;
      expect(out.children.map((c) => c.id)).toEqual(['B', 'C', 'D']);
      expect(out.active).toBe(1); // still shows C
      expect(out.children[out.active]?.id).toBe('C');
    });
    it('clamps when the active tab itself is removed', () => {
      const out = removePanel(tabsABCD(), 'C') as TabNode;
      expect(out.children.map((c) => c.id)).toEqual(['A', 'B', 'D']);
      expect(out.active).toBe(2); // shows D (next neighbour)
    });
    it('does not shift when a later tab is removed', () => {
      const out = removePanel(tabsABCD(), 'D') as TabNode;
      expect(out.children.map((c) => c.id)).toEqual(['A', 'B', 'C']);
      expect(out.active).toBe(2); // still shows C
      expect(out.children[out.active]?.id).toBe('C');
    });
  });
});

describe('tab + split tweaks', () => {
  it('setActiveTab clamps the index', () => {
    const withTab = insertRelative(rowAB(), 'B', makePanel('plot', 'C'), 'center', seqGen());
    const tabId = ((withTab as SplitNode).children[1] as TabNode).id;
    const out = setActiveTab(withTab, tabId, 9);
    expect(((out as SplitNode).children[1] as TabNode).active).toBe(1);
  });
  it('equalizeSplit resets sizes', () => {
    const out = equalizeSplit(rowAB(), 's') as SplitNode;
    expect(out.sizes).toEqual([0.5, 0.5]);
  });
});

describe('movePanel', () => {
  it('moves a panel into a tab of the target', () => {
    const out = movePanel(rowAB(), 'A', 'B', 'center', seqGen());
    // A removed (root collapses to B), then A added as a tab of B.
    expect((out as TabNode).type).toBe('tabs');
    expect((out as TabNode).children.map((c) => c.id)).toEqual(['B', 'A']);
  });
  it('is a no-op for src===target or the only panel', () => {
    expect(movePanel(rowAB(), 'A', 'A', 'left')).toEqual(rowAB());
    const only = makePanel('x', 'O');
    expect(movePanel(only, 'O', 'O', 'left')).toEqual(only);
  });
});

describe('migrateShellLayout', () => {
  const fallback: ShellLayout = {
    schemaVersion: 2,
    activeWorkspaceId: 'd',
    order: ['d'],
    workspaces: { d: { id: 'd', name: 'Default', root: makePanel('x', 'r') } },
  };
  it('passes a valid layout through + tags the schema version', () => {
    const legacy: unknown = {
      activeWorkspaceId: 'w',
      order: ['w'],
      workspaces: {
        w: { id: 'w', name: 'W', root: { type: 'panel', id: 'r', panelId: '@active-screen' } },
      },
    };
    const out = migrateShellLayout(legacy, fallback);
    expect(out.schemaVersion).toBe(2);
    expect(out.activeWorkspaceId).toBe('w');
  });
  it('falls back on invalid / foreign input (never throws)', () => {
    expect(migrateShellLayout(null, fallback)).toBe(fallback);
    expect(migrateShellLayout({ nope: true }, fallback)).toBe(fallback);
    expect(
      migrateShellLayout(
        { activeWorkspaceId: 'w', workspaces: { w: { id: 'w', root: 5 } } },
        fallback,
      ),
    ).toBe(fallback);
  });
});

describe('workspace tree node typing', () => {
  it('treats split/tabs/panel as DockNode', () => {
    const node: DockNode = makePanel('x', 'X');
    expect(node.type).toBe('panel');
  });
});
