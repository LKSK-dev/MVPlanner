/**
 * Registration glue for the parameter workbench (task T3.4; spec plan/05 §5.4
 * Config / §5.3 dock).
 *
 * Builds the dockable {@link PanelDef} that mounts {@link ParamWorkbench} with
 * the injected {@link ParamClient}, {@link ParamMetaResolver} and the file
 * callbacks. The Config screen assembly is the integrator: it owns the singleton
 * `ParamClient`/`ParamMetaStore` and wires `onSave`/`onLoad` to the param-file
 * module (T3.5), then mounts this panel by id (workspaces may dock it too).
 *
 * The panel mounts a fresh Solid root via `render()` (the same imperative
 * pattern the inspector / flight-screen panels use), capturing the deps by
 * closure — so it never relies on a provider the imperative mount cannot see.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { PanelApi, PanelDef, ParamClient } from '../../../../contracts';
import type { ParamMetaResolver, TFn } from '../../../widgets/paramgrid';
import { ParamWorkbench, type ParamFileCallbacks } from './workbench';

/** Stable panel id (the Config assembly / workspaces dock the workbench by this). */
export const PARAM_WORKBENCH_PANEL_ID = 'config.params';

/** Construction dependencies for the workbench panel. */
export interface ParamWorkbenchPanelDeps extends ParamFileCallbacks {
  /** Parameter microservice client (the singleton, app/connection-scoped). */
  readonly client: ParamClient;
  /** Metadata resolver (the singleton `ParamMetaStore`). */
  readonly meta: ParamMetaResolver;
  /** i18n translate function. */
  readonly t: TFn;
}

/** Build the dockable parameter-workbench {@link PanelDef} bound to `deps`. */
export function createParamWorkbenchPanel(deps: ParamWorkbenchPanelDeps): PanelDef {
  return {
    id: PARAM_WORKBENCH_PANEL_ID,
    title: deps.t('params.title'),
    icon: 'params',
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(ParamWorkbench, {
            client: deps.client,
            meta: deps.meta,
            t: api.t,
            ...(deps.onSave ? { onSave: deps.onSave } : {}),
            ...(deps.onLoad ? { onLoad: deps.onLoad } : {}),
          }),
        el,
      );
    },
  };
}
