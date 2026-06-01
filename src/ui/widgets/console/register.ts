/**
 * Registration glue for the scripting console (task T7.4; spec plan/05
 * §5.3/§5.4/§5.7, plan/06 §6.7).
 *
 * Exposes the console to the app through the frozen {@link UiRegistry} as a
 * dockable panel + a palette command (⌘K → "Open scripting console"), without
 * hard-wiring it into the shell tree. App calls {@link registerScriptingConsole}
 * once with a wired {@link ConsoleController}; everything is disposed via the
 * returned function.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { CommandDef, PanelApi, PanelDef, UiRegistry } from '../../../contracts';
import { ScriptingConsole, type TFn } from './console';
import type { ConsoleController } from './controller';

/** Stable panel id (workspaces/extensions may dock the console by this id). */
export const CONSOLE_PANEL_ID = 'widget.console';
/** Stable command id for opening/focusing the console. */
export const CONSOLE_OPEN_COMMAND_ID = 'console.open';

/** Optional wiring for {@link createScriptingConsolePanel}. */
export interface ScriptingConsoleOptions {
  /** Bundled `.d.ts` for autocomplete (from `buildExtApiDts()`). */
  apiDts?: string;
  /** Initial editor contents. */
  initialCode?: string;
}

/** Build the dockable scripting-console {@link PanelDef} bound to `controller`. */
export function createScriptingConsolePanel(
  controller: ConsoleController,
  t: TFn,
  opts: ScriptingConsoleOptions = {},
): PanelDef {
  return {
    id: CONSOLE_PANEL_ID,
    title: t('console.panel.label'),
    icon: 'console',
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(ScriptingConsole, {
            controller,
            t: api.t,
            ...(opts.apiDts !== undefined ? { apiDts: opts.apiDts } : {}),
            ...(opts.initialCode !== undefined ? { initialCode: opts.initialCode } : {}),
          }),
        el,
      );
    },
  };
}

/**
 * Register the scripting-console panel + an "open console" palette command on
 * the shell {@link UiRegistry}. Returns a disposer that unregisters both.
 *
 * @param openConsole - Shell hook that docks/focuses the console panel when the
 *   palette command runs (App wires this to its dock manager).
 */
export function registerScriptingConsole(
  registry: UiRegistry,
  controller: ConsoleController,
  t: TFn,
  opts: ScriptingConsoleOptions = {},
  openConsole?: () => void,
): () => void {
  const offPanel = registry.registerPanel(createScriptingConsolePanel(controller, t, opts));
  const command: CommandDef = {
    id: CONSOLE_OPEN_COMMAND_ID,
    title: t('console.command.open'),
    run: () => openConsole?.(),
  };
  const offCommand = registry.registerCommand(command);
  return (): void => {
    offCommand();
    offPanel();
  };
}
