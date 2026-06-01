/**
 * Registration glue for the PID / tuning panel (task T3.6; spec plan/05 §5.4
 * Config / §5.3 dock).
 *
 * Builds the dockable {@link PanelDef} that mounts {@link TuningPanel} with the
 * injected {@link ParamClient}, {@link ParamMetaResolver}, optional
 * {@link CommandClient} (autotune) and the reactive active-vehicle accessor. The
 * Config screen assembly owns the singleton client/meta/command and supplies the
 * vehicle accessor (derived from the store); a workspace may also dock this
 * panel by {@link TUNING_PANEL_ID}.
 *
 * The panel mounts a fresh Solid root via `render()` (the same imperative
 * pattern the workbench / settings panels use), capturing the deps by closure.
 */
import { createComponent, type Accessor } from 'solid-js';
import { render } from 'solid-js/web';
import type { CommandClient, PanelApi, PanelDef, ParamClient } from '../../../../contracts';
import type { ParamMetaResolver, TFn } from '../../../widgets/paramgrid';
import { TuningPanel, type TuningVehicle } from './tuning-panel';
import './messages';

/** Stable panel id (the Config assembly / workspaces dock tuning by this). */
export const TUNING_PANEL_ID = 'config.tuning';

/** Construction dependencies for the tuning panel. */
export interface TuningPanelDeps {
  /** Parameter microservice client (the singleton, app/connection-scoped). */
  readonly client: ParamClient;
  /** Metadata resolver (the singleton `ParamMetaStore`). */
  readonly meta: ParamMetaResolver;
  /** Command microservice for autotune (omit to hide the autotune controls). */
  readonly command?: CommandClient;
  /** Reactive active vehicle (selects the per-class parameter groups). */
  readonly vehicle: Accessor<TuningVehicle | undefined>;
  /** i18n translate function. */
  readonly t: TFn;
}

/** Build the dockable tuning {@link PanelDef} bound to `deps`. */
export function createTuningPanel(deps: TuningPanelDeps): PanelDef {
  return {
    id: TUNING_PANEL_ID,
    title: deps.t('tuning.title'),
    icon: 'tuning',
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(TuningPanel, {
            client: deps.client,
            meta: deps.meta,
            vehicle: deps.vehicle,
            t: api.t,
            ...(deps.command !== undefined ? { command: deps.command } : {}),
          }),
        el,
      );
    },
  };
}
