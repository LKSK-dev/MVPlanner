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

/** A leaf node that hosts a single widget instance. */
export interface PanelNode {
  readonly type: 'panel';
  /** Stable instance id (unique within a workspace). */
  readonly id: string;
  /** Registered widget id to mount (1.7.0; preferred over {@link panelId}). */
  readonly widgetId?: string;
  /**
   * Legacy/sentinel panel id (pre-0.4 layouts; {@link ACTIVE_SCREEN} follows the
   * active screen). Read via {@link widgetIdOf}, which prefers {@link widgetId}.
   */
  readonly panelId?: string;
  /** Per-instance widget settings (1.7.0). */
  readonly settings?: Readonly<Record<string, unknown>>;
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

/** A container that stacks widget panels as selectable tabs (1.7.0). */
export interface TabNode {
  readonly type: 'tabs';
  readonly id: string;
  /** Index of the visible child. */
  readonly active: number;
  readonly children: readonly PanelNode[];
}

/** A node in a workspace dock tree. */
export type DockNode = PanelNode | SplitNode | TabNode;

/** Drop zone for a drag-to-dock operation. */
export type DropZone = 'left' | 'right' | 'top' | 'bottom' | 'center';

/** Resolve a panel's widget id, preferring the 1.7.0 field over the legacy one. */
export function widgetIdOf(node: PanelNode): string {
  return node.widgetId ?? node.panelId ?? '';
}

/** A named, savable/restorable layout (spec plan/05 §5.3 "Workspaces"). */
export interface ShellWorkspace {
  readonly id: string;
  readonly name: string;
  readonly root: DockNode;
}

/** The full shell layout persisted inside `LayoutState.workspaces`. */
export interface ShellLayout {
  /** Persisted-schema version for migration (current: {@link SHELL_SCHEMA_VERSION}). */
  readonly schemaVersion?: number;
  readonly activeWorkspaceId: string;
  /** Display order of workspace ids. */
  readonly order: readonly string[];
  readonly workspaces: Readonly<Record<string, ShellWorkspace>>;
}

/** Current persisted shell-layout schema version. */
export const SHELL_SCHEMA_VERSION = 2;

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
  if (root.type === 'panel' || root.type === 'tabs') return root;
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

// ---------------------------------------------------------------------------
// Dock tree v2 reducers (1.7.0) — pure, immutable, unit-tested. Unrelated
// branches keep identity so Solid reconciliation stays cheap.
// ---------------------------------------------------------------------------

let nodeCounter = 0;
/** Default unique node-id generator (override in tests for determinism). */
export function nextNodeId(prefix = 'n'): string {
  nodeCounter += 1;
  return `${prefix}-${nodeCounter.toString(36)}`;
}

/** Build a {@link PanelNode} for a widget instance. */
export function makePanel(
  widgetId: string,
  id: string = nextNodeId('p'),
  settings?: Readonly<Record<string, unknown>>,
): PanelNode {
  return settings !== undefined
    ? { type: 'panel', id, widgetId, settings }
    : { type: 'panel', id, widgetId };
}

/** All panel leaves under `root`, in tree order. */
export function allPanels(root: DockNode): PanelNode[] {
  if (root.type === 'panel') return [root];
  const out: PanelNode[] = [];
  for (const child of root.children) out.push(...allPanels(child));
  return out;
}

/** Count panel leaves under `root`. */
export function countPanels(root: DockNode): number {
  return allPanels(root).length;
}

/** Find a panel leaf by instance id. */
export function findPanel(root: DockNode, id: string): PanelNode | undefined {
  return allPanels(root).find((p) => p.id === id);
}

/**
 * Remove the panel `id`, collapsing single-child splits/tabs and renormalising
 * sibling sizes. Returns the new tree, or `undefined` when removal would empty
 * the workspace (callers keep the old tree in that case).
 */
export function removePanel(root: DockNode, id: string): DockNode | undefined {
  if (root.type === 'panel') return root.id === id ? undefined : root;
  if (root.type === 'tabs') {
    const removedIndex = root.children.findIndex((c) => c.id === id);
    if (removedIndex < 0) return root;
    const kids = root.children.filter((c) => c.id !== id);
    if (kids.length === 0) return undefined;
    if (kids.length === 1) return kids[0];
    // Shift the active index when an earlier tab is removed so the same tab
    // stays visible; clamp for the removed-last-while-active case.
    const shifted = root.active - (removedIndex < root.active ? 1 : 0);
    const active = Math.max(0, Math.min(shifted, kids.length - 1));
    return { ...root, children: kids, active };
  }
  const kept: DockNode[] = [];
  const keptSizes: number[] = [];
  let changed = false;
  for (let i = 0; i < root.children.length; i += 1) {
    const child = root.children[i];
    if (child === undefined) continue;
    const next = removePanel(child, id);
    if (next !== child) changed = true;
    if (next !== undefined) {
      kept.push(next);
      keptSizes.push(root.sizes[i] ?? 1 / root.children.length);
    }
  }
  if (!changed) return root;
  if (kept.length === 0) return undefined;
  if (kept.length === 1) return kept[0];
  return { ...root, children: kept, sizes: normalizeSizes(keptSizes, kept.length) };
}

/** Set the active tab index of the tab container `tabId` (clamped). */
export function setActiveTab(root: DockNode, tabId: string, index: number): DockNode {
  if (root.type === 'panel') return root;
  if (root.type === 'tabs') {
    if (root.id !== tabId) return root;
    const active = Math.max(0, Math.min(index, root.children.length - 1));
    return active === root.active ? root : { ...root, active };
  }
  return { ...root, children: root.children.map((c) => setActiveTab(c, tabId, index)) };
}

/** Reset a split's sizes to an equal distribution. */
export function equalizeSplit(root: DockNode, splitId: string): DockNode {
  if (root.type === 'panel') return root;
  if (root.type === 'tabs') return root;
  if (root.id === splitId) {
    const n = root.children.length;
    return { ...root, sizes: Array.from({ length: n }, () => 1 / n) };
  }
  return { ...root, children: root.children.map((c) => equalizeSplit(c, splitId)) };
}

/** Wrap a leaf-unit in a 2-child split for an edge drop. */
function splitWith(
  unit: DockNode,
  panel: PanelNode,
  zone: DropZone,
  genId: () => string,
): SplitNode {
  const direction: 'row' | 'column' = zone === 'left' || zone === 'right' ? 'row' : 'column';
  const newFirst = zone === 'left' || zone === 'top';
  const children = newFirst ? [panel, unit] : [unit, panel];
  return { type: 'split', id: genId(), direction, sizes: [0.5, 0.5], children };
}

/**
 * Insert `panel` relative to the leaf/tab identified by `targetId`. `center`
 * adds it as a tab of the target (creating a tab group if needed); the edge
 * zones wrap the target unit in a new split. Pure; mints container ids via
 * `genId`.
 */
export function insertRelative(
  root: DockNode,
  targetId: string,
  panel: PanelNode,
  zone: DropZone,
  genId: () => string = nextNodeId,
): DockNode {
  const transform = (node: DockNode): DockNode => {
    if (node.type === 'tabs') {
      if (node.children.some((c) => c.id === targetId)) {
        if (zone === 'center') {
          return { ...node, children: [...node.children, panel], active: node.children.length };
        }
        return splitWith(node, panel, zone, genId);
      }
      return node;
    }
    if (node.type === 'panel') {
      if (node.id !== targetId) return node;
      if (zone === 'center') {
        return { type: 'tabs', id: genId(), active: 1, children: [node, panel] };
      }
      return splitWith(node, panel, zone, genId);
    }
    return { ...node, children: node.children.map(transform) };
  };
  return transform(root);
}

/**
 * Move an existing panel `srcId` to a drop zone of `targetId`. No-op when the
 * source is missing, is the target, or is the only panel.
 */
export function movePanel(
  root: DockNode,
  srcId: string,
  targetId: string,
  zone: DropZone,
  genId: () => string = nextNodeId,
): DockNode {
  if (srcId === targetId) return root;
  const node = findPanel(root, srcId);
  if (node === undefined) return root;
  const without = removePanel(root, srcId);
  if (without === undefined) return root; // can't move the only panel
  if (findPanel(without, targetId) === undefined) return root; // target gone
  return insertRelative(without, targetId, node, zone, genId);
}

// ---------------------------------------------------------------------------
// Persistence migration (1.7.0).
// ---------------------------------------------------------------------------

/** Structurally validate a {@link DockNode} (defensive; tolerates legacy panels). */
function isDockNode(value: unknown): value is DockNode {
  if (typeof value !== 'object' || value === null) return false;
  const node = value as { type?: unknown; children?: unknown };
  if (node.type === 'panel') return true;
  if (node.type === 'split' || node.type === 'tabs') {
    return Array.isArray(node.children) && node.children.every(isDockNode);
  }
  return false;
}

/** Validate a persisted shell layout shape (without trusting its contents). */
function isShellLayout(value: unknown): value is ShellLayout {
  if (typeof value !== 'object' || value === null) return false;
  const l = value as { activeWorkspaceId?: unknown; workspaces?: unknown };
  if (typeof l.activeWorkspaceId !== 'string') return false;
  if (typeof l.workspaces !== 'object' || l.workspaces === null) return false;
  return Object.values(l.workspaces as Record<string, unknown>).every((ws) => {
    if (typeof ws !== 'object' || ws === null) return false;
    const w = ws as { id?: unknown; root?: unknown };
    return typeof w.id === 'string' && isDockNode(w.root);
  });
}

/**
 * Migrate a persisted/unknown shell layout to a valid {@link ShellLayout},
 * falling back to `fallback` on any invalid/foreign input (never throws, never
 * yields a broken tree). Valid pre-0.4 layouts (legacy `panelId` panels) pass
 * through and are tagged with the current schema version.
 */
export function migrateShellLayout(raw: unknown, fallback: ShellLayout): ShellLayout {
  if (!isShellLayout(raw)) return fallback;
  const active = raw.workspaces[raw.activeWorkspaceId]
    ? raw.activeWorkspaceId
    : fallback.activeWorkspaceId;
  const order =
    Array.isArray(raw.order) && raw.order.every((id) => typeof id === 'string')
      ? raw.order
      : Object.keys(raw.workspaces);
  return {
    schemaVersion: SHELL_SCHEMA_VERSION,
    activeWorkspaceId: active,
    order,
    workspaces: raw.workspaces,
  };
}
