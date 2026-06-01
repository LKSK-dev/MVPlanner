/**
 * Registration glue for the Rally points editor (task T4.7; spec plan/05 §5.3
 * Plan dock).
 *
 * Builds a dockable {@link PanelDef} (`plan.rally`) that mounts
 * {@link RallyPanel}, capturing its `value` provider + `onChange` callback by
 * closure. The Plan screen assembly (or a workspace) references the panel by
 * {@link RALLY_PANEL_ID}; the panel mounts a fresh Solid root via `render()`
 * (the same imperative pattern the survey / settings / inspector panels use).
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { PanelApi, PanelDef } from '../../../../contracts';
import type { Rally } from '../../../../geo/rally';
import { RallyPanel } from './rally-panel';
import './messages';

/** Stable panel id (workspaces/extensions may dock the rally panel by this id). */
export const RALLY_PANEL_ID = 'plan.rally';

/** Construction dependencies for the Rally panel. */
export interface RallyPanelDeps {
  /** Returns the current rally model (owned by the Plan screen / map editor T4.4). */
  readonly value?: () => Rally;
  /** Receives the updated rally model after every edit. */
  readonly onChange?: (rally: Rally) => void;
}

/** Build the dockable `plan.rally` {@link PanelDef} bound to its deps. */
export function createRallyPanel(deps: RallyPanelDeps = {}): PanelDef {
  return {
    id: RALLY_PANEL_ID,
    title: 'Rally points',
    icon: 'flag',
    mount(el: HTMLElement, api: PanelApi): () => void {
      const value = deps.value?.();
      return render(
        () =>
          createComponent(RallyPanel, {
            t: api.t,
            ...(value !== undefined ? { value } : {}),
            ...(deps.onChange !== undefined ? { onChange: deps.onChange } : {}),
          }),
        el,
      );
    },
  };
}
