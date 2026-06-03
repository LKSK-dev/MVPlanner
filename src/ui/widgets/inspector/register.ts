/**
 * Registration glue for the MAVLink inspector (task T1.12; spec plan/04 §4.9,
 * plan/05 §5.3/§5.5/§5.7).
 *
 * Exposes the inspector to the app the same way other panels do — through the
 * frozen {@link UiRegistry} — without hard-wiring it into the shell tree:
 *
 *  - {@link createInspectorPanel} builds a dockable {@link PanelDef} that mounts
 *    the {@link Inspector} into a dock leaf (workspaces can reference its id).
 *  - {@link registerInspector} registers that panel AND an `Open MAVLink
 *    Inspector` command (reachable from the ⌘K palette) that pops the inspector
 *    out into a non-modal detachable window (spec §4.10 "inspector pop-out").
 *
 * The integrator calls `registerInspector(registry, host, t)` once with the
 * singleton MAVLink host (which satisfies {@link InspectorSource}); everything
 * is disposed via the returned function.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { CommandDef, PanelApi, PanelDef, UiRegistry } from '../../../contracts';
import { Inspector } from './inspector';
import type { InspectorSource, TFn } from './types';

/** Stable panel id (workspaces/extensions may dock the inspector by this id). */
export const INSPECTOR_PANEL_ID = 'widget.inspector';
/** Stable command id for the palette entry. */
export const INSPECTOR_COMMAND_ID = 'inspector.open';

/** Build the dockable inspector {@link PanelDef} bound to `source`. */
export function createInspectorPanel(source: InspectorSource, t: TFn): PanelDef {
  return {
    id: INSPECTOR_PANEL_ID,
    title: t('inspector.title'),
    icon: 'inspector',
    meta: { category: 'appsettings.layout.category.telemetry' },
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(() => createComponent(Inspector, { source, t: api.t }), el);
    },
  };
}

/** Live state of the singleton pop-out window. */
interface FloatingWindow {
  readonly close: () => void;
}

let floating: FloatingWindow | undefined;

/**
 * Toggle the detachable inspector window. Opening appends a non-modal
 * `role="dialog"` host to `<body>`, moves focus into it, and renders the
 * {@link Inspector}; Escape or the close button (or calling this again) closes
 * it and restores focus. Returns the active window handle (or `undefined` when
 * the call closed it).
 */
export function toggleInspectorWindow(source: InspectorSource, t: TFn): FloatingWindow | undefined {
  if (floating !== undefined) {
    floating.close();
    return undefined;
  }

  const previouslyFocused = document.activeElement as HTMLElement | null;

  const host = document.createElement('div');
  host.className = 'mvp-inspector-window';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-modal', 'false');
  host.setAttribute('aria-label', t('inspector.title'));

  const header = document.createElement('header');
  header.className = 'mvp-inspector-window__head';

  const heading = document.createElement('h2');
  heading.className = 'mvp-inspector-window__title';
  heading.textContent = t('inspector.title');

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mvp-inspector-window__close';
  closeBtn.setAttribute('aria-label', t('inspector.closeWindow'));
  closeBtn.textContent = '✕';

  header.append(heading, closeBtn);

  const body = document.createElement('div');
  body.className = 'mvp-inspector-window__body';

  host.append(header, body);
  document.body.appendChild(host);

  const disposeRender = render(() => createComponent(Inspector, { source, t }), body);

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  const close = (): void => {
    if (floating === undefined) return;
    floating = undefined;
    host.removeEventListener('keydown', onKeyDown);
    disposeRender();
    host.remove();
    previouslyFocused?.focus?.();
  };

  host.addEventListener('keydown', onKeyDown);
  closeBtn.addEventListener('click', close);
  closeBtn.focus();

  const handle: FloatingWindow = { close };
  floating = handle;
  return handle;
}

/**
 * Register the inspector panel + the `Open MAVLink Inspector` command on the
 * shell {@link UiRegistry}. Returns a disposer that unregisters both and closes
 * the pop-out window if open.
 */
export function registerInspector(
  registry: UiRegistry,
  source: InspectorSource,
  t: TFn,
): () => void {
  const offPanel = registry.registerPanel(createInspectorPanel(source, t));

  const command: CommandDef = {
    id: INSPECTOR_COMMAND_ID,
    title: t('inspector.open'),
    run: () => {
      toggleInspectorWindow(source, t);
    },
  };
  const offCommand = registry.registerCommand(command);

  return () => {
    floating?.close();
    offCommand();
    offPanel();
  };
}
