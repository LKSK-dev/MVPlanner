/**
 * Registration glue for the Joystick / gamepad control panel (task T8.6; spec
 * plan/05 §5.3/§5.4/§5.5).
 *
 * Exposes the widget to the app through the frozen {@link UiRegistry} as a
 * dockable panel without hard-wiring it into the shell tree. The Flight-screen
 * assembly calls {@link registerJoystick} once with the host-backed
 * {@link ManualControlService} and the browser Gamepad source; everything is
 * disposed via the returned function.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { PanelApi, PanelDef, UiRegistry } from '../../../contracts';
import type { GamepadSource, ManualControlService } from '../../../mavlink/microservices/manual';
import { Joystick } from './joystick';
import type { FailsafeTarget, TFn } from './types';

/** Stable panel id (workspaces/extensions may dock the joystick by this id). */
export const JOYSTICK_PANEL_ID = 'widget.joystick';

/** Optional wiring for {@link createJoystickPanel} / {@link registerJoystick}. */
export interface JoystickPanelOptions {
  /** Pump scheduler (defaults to a `requestAnimationFrame` loop). */
  schedule?: (cb: () => void) => () => void;
  /** Focus-loss failsafe target (defaults to the global `window`). */
  failsafeTarget?: FailsafeTarget;
}

/** Build the dockable Joystick {@link PanelDef} bound to `service` + `gamepad`. */
export function createJoystickPanel(
  service: ManualControlService,
  gamepad: GamepadSource,
  t: TFn,
  opts: JoystickPanelOptions = {},
): PanelDef {
  return {
    id: JOYSTICK_PANEL_ID,
    title: t('joystick.panel.label'),
    icon: 'joystick',
    meta: { category: 'appsettings.layout.category.tools', singleton: true },
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(Joystick, {
            service,
            gamepad,
            t: api.t,
            ...(opts.schedule !== undefined ? { schedule: opts.schedule } : {}),
            ...(opts.failsafeTarget !== undefined ? { failsafeTarget: opts.failsafeTarget } : {}),
          }),
        el,
      );
    },
  };
}

/**
 * Register the Joystick panel on the shell {@link UiRegistry}. Returns a
 * disposer that unregisters it.
 */
export function registerJoystick(
  registry: UiRegistry,
  service: ManualControlService,
  gamepad: GamepadSource,
  t: TFn,
  opts: JoystickPanelOptions = {},
): () => void {
  return registry.registerPanel(createJoystickPanel(service, gamepad, t, opts));
}
