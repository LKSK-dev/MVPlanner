/**
 * Layout mutation actions for the dockable workspace (UI remake Phase 1). One
 * code path the dock chrome AND the Settings → Appearance layout editor both use
 * to mutate the active workspace tree through the pure reducers in
 * `./workspace`, keeping every layout change consistent + persisted.
 */
import type { AppState, Store } from '../../contracts';
import { t } from '../../core/i18n';
import {
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
