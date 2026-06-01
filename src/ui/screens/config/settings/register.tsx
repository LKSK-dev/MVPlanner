/**
 * Registration glue for the App Settings screen (task T3.7; spec plan/05 §5.4
 * Settings, §5.3 dock).
 *
 * Builds a dockable {@link PanelDef} (`config.settings`) that mounts
 * {@link SettingsScreen} with the shared store, the injected Storage Manager
 * handles and the shell `confirm` seam. The Config screen assembly (or a
 * workspace) can reference the panel by {@link SETTINGS_PANEL_ID}; the panel
 * mounts a fresh Solid root via `render()` (the same imperative pattern the
 * inspector / flight panels use), capturing its deps by closure.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { AppState, PanelApi, PanelDef, Store } from '../../../../contracts';
import { SettingsScreen, type ConfirmFn } from './settings-screen';
import type { StorageManagerDeps } from './storage-manager';
import './messages';

/** Stable panel id (workspaces/extensions may dock Settings by this id). */
export const SETTINGS_PANEL_ID = 'config.settings';

/** Construction dependencies for the Settings panel. */
export interface SettingsPanelDeps {
  /** The shared app store (settings source + write target). */
  readonly store: Store<AppState>;
  /** Injected Storage Manager handles (spec plan/07 §7.3); optional. */
  readonly storage?: StorageManagerDeps;
  /** Safety-confirm seam for the factory reset (the shell `confirm`). */
  readonly confirm?: ConfirmFn;
}

/** Build the dockable `config.settings` {@link PanelDef} bound to its deps. */
export function createSettingsPanel(deps: SettingsPanelDeps): PanelDef {
  return {
    id: SETTINGS_PANEL_ID,
    title: 'Settings',
    icon: 'settings',
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(SettingsScreen, {
            store: deps.store,
            t: api.t,
            ...(deps.storage !== undefined ? { storage: deps.storage } : {}),
            ...(deps.confirm !== undefined ? { confirm: deps.confirm } : {}),
          }),
        el,
      );
    },
  };
}
