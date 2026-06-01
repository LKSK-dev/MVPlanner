/**
 * Registration glue for the waypoint table (task T4.3; spec plan/05 §5.4 Plan
 * dock).
 *
 * Builds a dockable {@link PanelDef} (`plan.table`) that mounts
 * {@link WaypointTable} with the Plan assembly's reactive `model()` accessor and
 * `onChange` writer injected by closure (the same imperative `render()` pattern
 * the survey / settings / inspector panels use). The Plan screen (or a
 * workspace) references the panel by {@link WP_TABLE_PANEL_ID}.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { PanelApi, PanelDef } from '../../../../contracts';
import type { MavCmdMeta, MissionModel, UnitSystem } from './types';
import { WaypointTable } from './wp-table';
import './messages';

/** Stable panel id (workspaces/extensions may dock the waypoint table by this id). */
export const WP_TABLE_PANEL_ID = 'plan.table';

/** Construction dependencies for the waypoint table panel. */
export interface WaypointTablePanelDeps {
  /** Reactive accessor for the controlled mission model. */
  readonly model: () => MissionModel;
  /** Receives the next model after any edit / undo / redo. */
  readonly onChange: (next: MissionModel) => void;
  /** Reactive accessor for the unit system used to format totals. */
  readonly units?: () => UnitSystem;
  /** Commands offered by the per-row picker (default the curated mission set). */
  readonly commands?: readonly MavCmdMeta[];
  /** Cruise speed (m/s) for the time estimate. */
  readonly cruiseSpeedMps?: number;
  /** Maximum undo/redo depth. */
  readonly undoLimit?: number;
}

/** Build the dockable `plan.table` {@link PanelDef} bound to its deps. */
export function createWaypointTablePanel(deps: WaypointTablePanelDeps): PanelDef {
  return {
    id: WP_TABLE_PANEL_ID,
    title: 'Waypoints',
    icon: 'list',
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(WaypointTable, {
            model: deps.model,
            onChange: deps.onChange,
            t: api.t,
            ...(deps.units ? { units: deps.units } : {}),
            ...(deps.commands ? { commands: deps.commands } : {}),
            ...(deps.cruiseSpeedMps !== undefined ? { cruiseSpeedMps: deps.cruiseSpeedMps } : {}),
            ...(deps.undoLimit !== undefined ? { undoLimit: deps.undoLimit } : {}),
          }),
        el,
      );
    },
  };
}
