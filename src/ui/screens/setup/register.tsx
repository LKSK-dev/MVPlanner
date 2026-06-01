/**
 * Registration glue for the Setup screen (task T5.12; spec plan/05 §5.2
 * registration, §5.4 Setup).
 *
 * Builds the REAL `screen.setup` {@link PanelDef} that mounts {@link SetupScreen}
 * with the app/connection-scoped {@link CalibrationClient} / {@link ParamClient}
 * / {@link CommandClient}, the shared store and the shell `confirm` seam.
 * {@link App} installs it through {@link import('../../shell').setScreenPanel}
 * BEFORE the shell renders, so the dock mounts the real Setup screen over the
 * placeholder and keeps the rest as placeholders.
 *
 * The panel mounts a fresh Solid root via `render()` (the same imperative pattern
 * the Flight/Config/Plan screens use), capturing the services by closure. The
 * default-active frame step loads the parameter set on its own mount, and the
 * assembly exposes a Fetch/Refresh affordance for an explicit global reload.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type {
  AppState,
  CalibrationClient,
  CommandClient,
  PanelApi,
  PanelDef,
  ParamClient,
  Store,
} from '../../../contracts';
import { screenPanelId, type ShellRegistry } from '../../shell';
import { SetupScreen } from './setup-screen';
import type { TFn } from './framework';
import './messages';

/** Stable panel id for the Setup screen (`screen.setup`). */
export const SETUP_SCREEN_PANEL_ID = screenPanelId('setup');

/** Construction dependencies for the Setup screen panel. */
export interface SetupScreenPanelDeps {
  /** App/connection-scoped calibration microservice. */
  readonly calibration: CalibrationClient;
  /** Shared parameter microservice (cache shared with Config). */
  readonly param: ParamClient;
  /** Command microservice (motor test step). */
  readonly command: CommandClient;
  /** The shared app store (active-vehicle class + armed state). */
  readonly store: Store<AppState>;
  /** The shell registry (for the `confirm` seam). */
  readonly registry: ShellRegistry;
  /** i18n translate function. */
  readonly t: TFn;
}

/** Build the real `screen.setup` {@link PanelDef} bound to the services. */
export function createSetupScreenPanel(deps: SetupScreenPanelDeps): PanelDef {
  return {
    id: SETUP_SCREEN_PANEL_ID,
    title: deps.t('nav.setup'),
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(SetupScreen, {
            calibration: deps.calibration,
            param: deps.param,
            command: deps.command,
            store: deps.store,
            confirm: (opts) => deps.registry.confirm(opts),
            t: api.t,
          }),
        el,
      );
    },
  };
}
