/**
 * Registration glue for the terrain profile panel (task T4.8; spec plan/05 §5.3
 * Plan dock).
 *
 * Builds a dockable {@link PanelDef} (`plan.terrain`) that mounts
 * {@link TerrainProfile} with an injected profile-point provider. The Plan
 * screen assembly (or a workspace) references the panel by
 * {@link TERRAIN_PANEL_ID}; the panel mounts a fresh Solid root via `render()`
 * (the same imperative pattern the survey / settings / inspector panels use),
 * capturing its deps by closure. The async elevation sampling that produces the
 * points lives in `geo/terrain`, off this panel.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { PanelApi, PanelDef } from '../../../../contracts';
import type { TerrainProfilePoint } from '../../../../geo/terrain';
import { TerrainProfile } from './terrain-profile';
import './messages';

/** Stable panel id (workspaces/extensions may dock the terrain panel by this id). */
export const TERRAIN_PANEL_ID = 'plan.terrain';

/** Construction dependencies for the terrain profile panel. */
export interface TerrainPanelDeps {
  /** Returns the current profile points (terrain + planned altitude). */
  readonly points: () => readonly TerrainProfilePoint[];
  /** Minimum acceptable clearance (m); points below it are flagged. */
  readonly minClearanceM?: number;
}

/** Build the dockable `plan.terrain` {@link PanelDef} bound to its deps. */
export function createTerrainPanel(deps: TerrainPanelDeps): PanelDef {
  return {
    id: TERRAIN_PANEL_ID,
    title: 'Terrain profile',
    icon: 'terrain',
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(TerrainProfile, {
            points: deps.points(),
            t: api.t,
            ...(deps.minClearanceM !== undefined ? { minClearanceM: deps.minClearanceM } : {}),
          }),
        el,
      );
    },
  };
}
