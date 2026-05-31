import { describe, it, expect } from 'vitest';
import type { LayoutState } from '../../src/contracts';
import {
  ACTIVE_SCREEN,
  DEFAULT_WORKSPACE_ID,
  SHELL_LAYOUT_KEY,
  activateWorkspace,
  activeWorkspace,
  defaultShellLayout,
  readShellLayout,
  saveWorkspaceAs,
  setSplitSizes,
  writeShellLayout,
  type ShellLayout,
  type SplitNode,
} from '../../src/ui/shell';

const layout = (): LayoutState => ({ activeScreen: 'flight', workspaces: {} });

describe('defaultShellLayout', () => {
  it('builds a single panel that follows the active screen', () => {
    const shell = defaultShellLayout('Default');
    const ws = activeWorkspace(shell);
    expect(shell.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(ws.root.type).toBe('panel');
    expect(ws.root.type === 'panel' ? ws.root.panelId : '').toBe(ACTIVE_SCREEN);
  });
});

describe('read/writeShellLayout boundary', () => {
  it('falls back to default when nothing persisted', () => {
    const shell = readShellLayout(layout(), 'Default');
    expect(shell.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);
  });

  it('round-trips through the generic LayoutState slot', () => {
    const draft = layout();
    const original = defaultShellLayout('Default');
    writeShellLayout(draft, original);
    expect(draft.workspaces[SHELL_LAYOUT_KEY]).toBeDefined();
    expect(readShellLayout(draft, 'Default')).toEqual(original);
  });
});

describe('setSplitSizes', () => {
  const split: SplitNode = {
    type: 'split',
    id: 's1',
    direction: 'row',
    sizes: [0.5, 0.5],
    children: [
      { type: 'panel', id: 'a', panelId: 'p.a' },
      { type: 'panel', id: 'b', panelId: 'p.b' },
    ],
  };

  it('normalises new sizes to sum to 1', () => {
    const next = setSplitSizes(split, 's1', [3, 1]) as SplitNode;
    const sum = next.sizes.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 6);
    expect(next.sizes[0]).toBeGreaterThan(next.sizes[1]!);
  });

  it('clamps a dragged-to-zero panel to a positive minimum', () => {
    const next = setSplitSizes(split, 's1', [1, 0]) as SplitNode;
    expect(next.sizes[1]).toBeGreaterThan(0);
  });

  it('leaves unrelated splits untouched', () => {
    const next = setSplitSizes(split, 'other', [0.9, 0.1]) as SplitNode;
    expect(next.sizes).toEqual([0.5, 0.5]);
  });
});

describe('save / restore workspaces', () => {
  it('saves the current tree under a new named workspace and activates it', () => {
    const base: ShellLayout = defaultShellLayout('Default');
    const saved = saveWorkspaceAs(base, 'tuning', 'Tuning');
    expect(saved.activeWorkspaceId).toBe('tuning');
    expect(saved.order).toContain('tuning');
    expect(saved.workspaces['tuning']?.name).toBe('Tuning');
    expect(saved.workspaces[DEFAULT_WORKSPACE_ID]).toBeDefined();
  });

  it('restores a previously saved workspace by id', () => {
    const saved = saveWorkspaceAs(defaultShellLayout('Default'), 'tuning', 'Tuning');
    const restored = activateWorkspace(saved, DEFAULT_WORKSPACE_ID);
    expect(restored.activeWorkspaceId).toBe(DEFAULT_WORKSPACE_ID);
  });

  it('ignores activation of an unknown workspace', () => {
    const base = defaultShellLayout('Default');
    expect(activateWorkspace(base, 'nope')).toBe(base);
  });
});
