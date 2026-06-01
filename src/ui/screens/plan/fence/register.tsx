/**
 * Registration glue for the Geofence editor (task T4.6; spec plan/05 §5.3 Plan
 * dock).
 *
 * Builds a dockable {@link PanelDef} (`plan.fence`) that mounts
 * {@link FencePanel} with an injected `onChange` callback (and optional initial
 * fence). The Plan screen assembly (or a workspace) references the panel by
 * {@link FENCE_PANEL_ID}; the panel mounts a fresh Solid root via `render()`
 * (the same imperative pattern the survey / settings / inspector panels use),
 * capturing its deps by closure.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { PanelApi, PanelDef } from '../../../../contracts';
import type { Fence } from '../../../../geo/fence';
import { FencePanel } from './fence-panel';
import './messages';

/** Stable panel id (workspaces/extensions may dock the fence panel by this id). */
export const FENCE_PANEL_ID = 'plan.fence';

/** Construction dependencies for the Geofence panel. */
export interface FencePanelDeps {
  /** Optional initial fence (defaults to an empty fence with default limits). */
  readonly initial?: Fence;
  /** Receives the current fence whenever it changes. */
  readonly onChange?: (fence: Fence) => void;
}

/** Build the dockable `plan.fence` {@link PanelDef} bound to its deps. */
export function createFencePanel(deps: FencePanelDeps = {}): PanelDef {
  return {
    id: FENCE_PANEL_ID,
    title: 'Geofence',
    icon: 'fence',
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(FencePanel, {
            t: api.t,
            ...(deps.initial !== undefined ? { initial: deps.initial } : {}),
            ...(deps.onChange !== undefined ? { onChange: deps.onChange } : {}),
          }),
        el,
      );
    },
  };
}
