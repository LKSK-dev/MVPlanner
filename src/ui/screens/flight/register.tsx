/**
 * Registration glue for the Flight Data screen (task T2.11; spec plan/05 §5.2
 * Flight screen registration, §5.3 dock).
 *
 * The shell registers six placeholder screen panels (`screen.<id>`). This module
 * builds the REAL `screen.flight` {@link PanelDef} that mounts {@link FlightScreen}
 * with the app/connection-scoped {@link FlightServices}, the shared store and the
 * shell `confirm` seam. {@link App} installs it through
 * {@link import('../../shell').setScreenPanel} BEFORE the shell renders, so the
 * dock mounts the real screen for `flight` and keeps the other five placeholders.
 *
 * The panel mounts a fresh Solid root via `render()` (the same imperative pattern
 * the inspector/quick-watch panels use), capturing the services by closure — so
 * the screen never relies on a provider that the imperative mount cannot see.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { AppState, PanelApi, PanelDef, Store } from '../../../contracts';
import type { ShellRegistry } from '../../shell';
import { screenPanelId } from '../../shell';
import { FlightScreen, type TFn } from './flight-screen';
import type { FlightServices } from './services';
import './messages';

/** Stable panel id for the Flight screen (`screen.flight`). */
export const FLIGHT_SCREEN_PANEL_ID = screenPanelId('flight');

/** Construction dependencies for the Flight screen panel. */
export interface FlightScreenPanelDeps {
  /** App/connection-scoped services (command/audit/recorder/STATUSTEXT). */
  readonly services: FlightServices;
  /** The shared app store. */
  readonly store: Store<AppState>;
  /** The shell registry (for the `confirm` seam). */
  readonly registry: ShellRegistry;
  /** i18n translate function. */
  readonly t: TFn;
}

/** Build the real `screen.flight` {@link PanelDef} bound to the services. */
export function createFlightScreenPanel(deps: FlightScreenPanelDeps): PanelDef {
  return {
    id: FLIGHT_SCREEN_PANEL_ID,
    title: deps.t('nav.flight'),
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(FlightScreen, {
            services: deps.services,
            store: deps.store,
            confirm: (opts) => deps.registry.confirm(opts),
            t: api.t,
          }),
        el,
      );
    },
  };
}
