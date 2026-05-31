/**
 * `ui/shell` public surface (T0.7; spec plan/05 §5.2/§5.3/§5.7). The shell wires
 * the frozen core modules (store, theme, i18n, capabilities, storage) into a
 * working, accessible application frame: top bar + screen navigation, command
 * palette, dockable workspace manager and the alert/toast center. Cross-module
 * consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3).
 */
export { Shell } from './shell';
export { createUiRegistry } from './registry';
export type { ShellRegistry, ShellToast, ShellConfirmRequest, ShellMenuItem } from './registry';
export { ShellContext, useShell, type ShellContextValue } from './context';
export { SCREEN_ORDER, screenPanelId, createScreenPanels } from './screens';
export {
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
  type DockNode,
  type PanelNode,
  type ShellLayout,
  type ShellWorkspace,
  type SplitNode,
} from './workspace';
export { fuzzyFilter, fuzzyScore } from './fuzzy';
