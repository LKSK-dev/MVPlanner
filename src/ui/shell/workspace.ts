/**
 * Shell-internal dock/workspace layout model + pure helpers (T0.7; spec
 * plan/05 §5.3).
 *
 * The frozen {@link LayoutState} contract keeps `workspaces` intentionally
 * generic (`Record<string, unknown>`). This module defines the concrete shell
 * shape and stores it inside `layout.workspaces` under a single reserved key,
 * casting only at that boundary ({@link readShellLayout}/{@link writeShellLayout}).
 * Everything here is pure and browser-free so the split/resize/save/restore
 * framework is unit-testable without a DOM.
 */
import type { LayoutState } from '../../contracts';

/** A leaf node that hosts a single registered panel. */
export interface PanelNode {
  readonly type: 'panel';
  readonly id: string;
  /**
   * Registered panel id to mount, or the sentinel {@link ACTIVE_SCREEN} which
   * the renderer resolves to the current `layout.activeScreen` panel.
   */
  readonly panelId: string;
}

/** A container that tiles its children along one axis with resizable gutters. */
export interface SplitNode {
  readonly type: 'split';
  readonly id: string;
  readonly direction: 'row' | 'column';
  /** Fractional sizes (sum ~= 1), one per child, same order as {@link children}. */
  readonly sizes: readonly number[];
  readonly children: readonly DockNode[];
}

/** A node in a workspace dock tree. */
export type DockNode = PanelNode | SplitNode;

/** A named, savable/restorable layout (spec plan/05 §5.3 "Workspaces"). */
export interface ShellWorkspace {
  readonly id: string;
  readonly name: string;
  readonly root: DockNode;
}

/** The full shell layout persisted inside `LayoutState.workspaces`. */
export interface ShellLayout {
  readonly activeWorkspaceId: string;
  /** Display order of workspace ids. */
  readonly order: readonly string[];
  readonly workspaces: Readonly<Record<string, ShellWorkspace>>;
}

/** Reserved key under which the shell stores its layout in `layout.workspaces`. */
export const SHELL_LAYOUT_KEY = '__shell__';

/** Sentinel panel id resolved to the active screen's panel by the renderer. */
export const ACTIVE_SCREEN = '@active-screen';

/** Id of the always-present default workspace. */
export const DEFAULT_WORKSPACE_ID = 'default';

/** Build the default single-panel workspace whose content follows the screen. */
export function defaultShellLayout(name: string): ShellLayout {
  const root: PanelNode = { type: 'panel', id: 'root', panelId: ACTIVE_SCREEN };
  const workspace: ShellWorkspace = { id: DEFAULT_WORKSPACE_ID, name, root };
  return {
    activeWorkspaceId: DEFAULT_WORKSPACE_ID,
    order: [DEFAULT_WORKSPACE_ID],
    workspaces: { [DEFAULT_WORKSPACE_ID]: workspace },
  };
}

/**
 * Read the shell layout from the generic {@link LayoutState}, falling back to
 * {@link defaultShellLayout} when none has been persisted yet. This is the only
 * place the `unknown` boundary is narrowed.
 */
export function readShellLayout(layout: LayoutState, defaultName: string): ShellLayout {
  const stored = layout.workspaces[SHELL_LAYOUT_KEY] as ShellLayout | undefined;
  if (stored && typeof stored.activeWorkspaceId === 'string' && stored.workspaces) {
    return stored;
  }
  return defaultShellLayout(defaultName);
}

/** Write the shell layout back into a {@link LayoutState} draft (store patch). */
export function writeShellLayout(draft: LayoutState, shell: ShellLayout): void {
  draft.workspaces[SHELL_LAYOUT_KEY] = shell;
}

/** Resolve the active workspace, or the default workspace as a safety net. */
export function activeWorkspace(shell: ShellLayout): ShellWorkspace {
  return shell.workspaces[shell.activeWorkspaceId] ?? Object.values(shell.workspaces)[0]!;
}

/**
 * Replace a split node's `sizes` (immutably). Returns a new tree; unrelated
 * branches keep their identity so reconciliation stays cheap. Sizes are
 * normalised to sum to 1 and clamped to a small minimum so a panel can never be
 * dragged to zero width.
 */
export function setSplitSizes(root: DockNode, splitId: string, sizes: readonly number[]): DockNode {
  if (root.type === 'panel') return root;
  if (root.id === splitId) {
    return { ...root, sizes: normalizeSizes(sizes, root.children.length) };
  }
  return { ...root, children: root.children.map((c) => setSplitSizes(c, splitId, sizes)) };
}

/** Clamp + normalise fractional sizes to a stable, positive distribution. */
export function normalizeSizes(sizes: readonly number[], count: number): number[] {
  const min = 0.05;
  const clamped = Array.from({ length: count }, (_, i) => Math.max(min, sizes[i] ?? 1 / count));
  const total = clamped.reduce((a, b) => a + b, 0);
  return clamped.map((s) => s / total);
}

/**
 * Save the current workspace's tree under a new named workspace and activate
 * it. Pure: returns a new {@link ShellLayout}. Used by the "Save workspace"
 * command to demonstrate persist/restore (spec plan/05 §5.3).
 */
export function saveWorkspaceAs(shell: ShellLayout, id: string, name: string): ShellLayout {
  const current = activeWorkspace(shell);
  const next: ShellWorkspace = { id, name, root: current.root };
  const order = shell.order.includes(id) ? shell.order : [...shell.order, id];
  return {
    activeWorkspaceId: id,
    order,
    workspaces: { ...shell.workspaces, [id]: next },
  };
}

/** Activate an existing workspace by id (no-op when unknown). */
export function activateWorkspace(shell: ShellLayout, id: string): ShellLayout {
  if (!shell.workspaces[id]) return shell;
  return { ...shell, activeWorkspaceId: id };
}
