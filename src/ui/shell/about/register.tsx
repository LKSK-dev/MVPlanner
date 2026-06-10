/** Registration glue for the dockable About panel and palette command. */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { CommandDef, PanelApi, PanelDef, UiRegistry } from '../../../contracts';
import { openFloatingPanel, type FloatingPanelHandle } from '../connection/floating-panel';
import { AboutPanel, type AboutT } from './about';
import './messages';

/** Stable dock panel id for About. */
export const ABOUT_PANEL_ID = 'about.panel';

/** Stable command id for the command palette entry. */
export const ABOUT_COMMAND_ID = 'about.open';

/** Build the dockable About panel definition. */
export function createAboutPanel(t: AboutT): PanelDef {
  return {
    id: ABOUT_PANEL_ID,
    title: t('about.title'),
    icon: 'info',
    meta: { category: 'appsettings.layout.category.info', singleton: true },
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(() => createComponent(AboutPanel, { t: api.t }), el);
    },
  };
}

/** Register the About dock panel and its `About MVPlanner` palette command. */
export function registerAbout(registry: UiRegistry, t: AboutT): () => void {
  const offPanel = registry.registerPanel(createAboutPanel(t));
  let floating: FloatingPanelHandle | undefined;

  const command: CommandDef = {
    id: ABOUT_COMMAND_ID,
    title: t('about.command.open'),
    run: () => {
      if (floating !== undefined) {
        floating.close();
        floating = undefined;
        return;
      }
      floating = openFloatingPanel({
        title: t('about.title'),
        closeLabel: t('about.close'),
        className: 'mvp-floating-panel--about',
        onClose: () => {
          floating = undefined;
        },
        mount: (body) => render(() => createComponent(AboutPanel, { t }), body),
      });
    },
  };
  const offCommand = registry.registerCommand(command);

  return () => {
    floating?.close();
    floating = undefined;
    offCommand();
    offPanel();
  };
}
