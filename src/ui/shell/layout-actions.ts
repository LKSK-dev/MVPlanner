/**
 * Layout mutation actions for the dockable workspace (UI remake Phase 1). One
 * code path the dock chrome AND the Settings → Appearance layout editor both use
 * to mutate the active workspace tree through the pure reducers in
 * `./workspace`, keeping every layout change consistent + persisted.
 */
import type { AppState, ScreenId, Store } from '../../contracts';
import { t } from '../../core/i18n';
import { SCREEN_ORDER } from './screens';
import { resetWorkspaceToPreset } from './presets';
import {
  activateWorkspace,
  activeWorkspace,
  allPanels,
  countPanels,
  equalizeSplit,
  insertRelative,
  makePanel,
  movePanel,
  readShellLayout,
  removePanel,
  setActiveTab,
  writeShellLayout,
  type DockNode,
  type DropZone,
} from './workspace';

/**
 * Switch to a screen's workspace (UI remake nav). Keeps `layout.activeScreen` in
 * sync (so the legacy sentinel + any screen-aware code still resolve) and points
 * the dock at that screen's workspace.
 */
export function activateScreenWorkspace(store: Store<AppState>, screenId: string): void {
  store.patch((s) => {
    s.layout.activeScreen = screenId as ScreenId;
    const shell = readShellLayout(s.layout, t('workspace.default'));
    writeShellLayout(s.layout, activateWorkspace(shell, screenId));
  });
}

/** Set the active workspace by id (keeps `activeScreen` in sync for screens). */
export function setActiveWorkspace(store: Store<AppState>, id: string): void {
  store.patch((s) => {
    if ((SCREEN_ORDER as readonly string[]).includes(id)) s.layout.activeScreen = id as ScreenId;
    const shell = readShellLayout(s.layout, t('workspace.default'));
    writeShellLayout(s.layout, activateWorkspace(shell, id));
  });
}

/**
 * Reset the active workspace back to its built-in preset. Returns `false`
 * (without patching) when the active workspace has no preset — i.e. its id is
 * not a screen id — so callers can surface feedback (audit D5).
 */
export function resetActiveWorkspace(store: Store<AppState>): boolean {
  const id = readShellLayout(store.get().layout, t('workspace.default')).activeWorkspaceId;
  if (!(SCREEN_ORDER as readonly string[]).includes(id)) return false;
  store.patch((s) => {
    const shell = readShellLayout(s.layout, t('workspace.default'));
    writeShellLayout(
      s.layout,
      resetWorkspaceToPreset(shell, shell.activeWorkspaceId, t(`nav.${shell.activeWorkspaceId}`)),
    );
  });
  return true;
}

/** Apply `fn` to the active workspace's root; an `undefined` result is refused. */
function mutateActiveRoot(
  store: Store<AppState>,
  fn: (root: DockNode) => DockNode | undefined,
): void {
  store.patch((s) => {
    const shell = readShellLayout(s.layout, t('workspace.default'));
    const ws = activeWorkspace(shell);
    const root = fn(ws.root);
    if (root === undefined) return; // refused (e.g. removing the last panel)
    writeShellLayout(s.layout, {
      ...shell,
      workspaces: { ...shell.workspaces, [ws.id]: { ...ws, root } },
    });
  });
}

/** Close a widget instance, refusing to remove the workspace's last panel. */
export function closeWidget(store: Store<AppState>, panelId: string): void {
  mutateActiveRoot(store, (root) =>
    countPanels(root) <= 1 ? undefined : removePanel(root, panelId),
  );
}

/** Select tab `index` of the tab container `tabId`. */
export function setWidgetTab(store: Store<AppState>, tabId: string, index: number): void {
  mutateActiveRoot(store, (root) => setActiveTab(root, tabId, index));
}

/** Reset a split's child sizes to equal. */
export function equalizeWidgets(store: Store<AppState>, splitId: string): void {
  mutateActiveRoot(store, (root) => equalizeSplit(root, splitId));
}

/** Move an existing widget instance to a drop zone of `targetId`. */
export function moveWidget(
  store: Store<AppState>,
  srcId: string,
  targetId: string,
  zone: DropZone,
): void {
  mutateActiveRoot(store, (root) => movePanel(root, srcId, targetId, zone));
}

/**
 * Add a new widget. With a target + zone it docks relative to that panel; with
 * no target it docks to the right of the first panel (or becomes the root when
 * the workspace is somehow empty).
 */
export function addWidget(
  store: Store<AppState>,
  widgetId: string,
  target?: { id: string; zone: DropZone },
): void {
  mutateActiveRoot(store, (root) => {
    const panel = makePanel(widgetId);
    if (target !== undefined) return insertRelative(root, target.id, panel, target.zone);
    const first = allPanels(root)[0];
    return first !== undefined ? insertRelative(root, first.id, panel, 'right') : panel;
  });
}
