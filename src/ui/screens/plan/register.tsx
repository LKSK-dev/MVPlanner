/**
 * Registration glue for the Flight Plan screen (task T4.10; spec plan/05 §5.2
 * screen registration, §5.4 Plan).
 *
 * Builds the REAL `screen.plan` {@link PanelDef} that mounts {@link PlanScreen}
 * with the app/connection-scoped {@link FlightServices} (mission client, params,
 * file I/O, terrain provider). {@link App} installs it through
 * {@link import('../../shell').setScreenPanel} BEFORE the shell renders, so the
 * dock mounts the real Plan screen instead of the placeholder.
 *
 * The panel mounts a fresh Solid root via `render()` (the same imperative
 * pattern the Flight/inspector panels use), capturing the services by closure.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { AppState, PanelApi, PanelDef, Store } from '../../../contracts';
import { screenPanelId } from '../../shell';
import { PlanScreen, type TFn } from './plan-screen';
import type { FlightServices } from '../flight/services';
import './messages';

/** Stable panel id for the Plan screen (`screen.plan`). */
export const PLAN_SCREEN_PANEL_ID = screenPanelId('plan');

/** Construction dependencies for the Plan screen panel. */
export interface PlanScreenPanelDeps {
  /** App/connection-scoped services (mission/param/files/terrain). */
  readonly services: FlightServices;
  /** i18n translate function. */
  readonly t: TFn;
  /** App store, so the plan map auto-centers on the active vehicle/home. */
  readonly store?: Store<AppState>;
}

/** Build the real `screen.plan` {@link PanelDef} bound to the services. */
export function createPlanScreenPanel(deps: PlanScreenPanelDeps): PanelDef {
  return {
    id: PLAN_SCREEN_PANEL_ID,
    title: deps.t('nav.plan'),
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(PlanScreen, {
            services: deps.services,
            t: api.t,
            ...(deps.store !== undefined ? { store: deps.store } : {}),
          }),
        el,
      );
    },
  };
}
