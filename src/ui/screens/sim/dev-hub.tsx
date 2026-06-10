/**
 * Sim & Dev Tools hub (M7 assembly; spec plan/05 §5.4, plan/06 §6.1/§6.7).
 *
 * Composes the `sim` screen as a tabbed developer hub: a SITL/Connect help pane
 * plus the Extensions Manager, Scripting Console and API Reference panels. The
 * three tool panels are mounted ONCE into hidden host containers and toggled by
 * tab so their state (installed list, console history, API filter) survives tab
 * switches; only the active pane is visible. Each panel mounts its own Solid
 * root, mirroring the Config screen composition.
 */
import { For, createSignal, onCleanup, onMount, type Accessor, type Component } from 'solid-js';
import type { PanelApi, PanelDef } from '../../../contracts';
import type { TFn } from '../../../core/i18n';
import './messages';

export type { TFn };

/** Props for {@link SimDevHub}. */
export interface SimDevHubProps {
  /** The Extensions Manager panel. */
  readonly managerPanel: PanelDef;
  /** The Scripting Console panel. */
  readonly consolePanel: PanelDef;
  /** The API Reference panel. */
  readonly apiRefPanel: PanelDef;
  /** The host panel's {@link PanelApi} (threaded to the sub-panel mounts). */
  readonly api: PanelApi;
  /** i18n translate fn. */
  readonly t: TFn;
  /** Optional controlled active-tab accessor (else internal, defaulting to help). */
  readonly active?: Accessor<string>;
  /** Optional setter invoked when a tab is clicked (with the controlled accessor). */
  readonly onActivate?: (id: string) => void;
}

/** One tool tab: a panel mounted into a hidden host. */
interface ToolTab {
  readonly id: string;
  readonly labelKey: string;
  readonly panel: PanelDef;
}

/** The composed Sim & Dev Tools hub. */
export const SimDevHub: Component<SimDevHubProps> = (props) => {
  const t = props.t;

  const tools: readonly ToolTab[] = [
    { id: 'extensions', labelKey: 'sim.tab.extensions', panel: props.managerPanel },
    { id: 'console', labelKey: 'sim.tab.console', panel: props.consolePanel },
    { id: 'api', labelKey: 'sim.tab.api', panel: props.apiRefPanel },
  ];

  const [internalActive, setInternalActive] = createSignal<string>('help');
  const active = (): string => props.active?.() ?? internalActive();
  const setActive = (id: string): void => {
    if (props.onActivate !== undefined) props.onActivate(id);
    else setInternalActive(id);
  };

  const hosts = new Map<string, HTMLElement>();
  const disposers: Array<() => void> = [];

  onMount(() => {
    for (const tool of tools) {
      const host = hosts.get(tool.id);
      if (host === undefined) continue;
      const dispose = tool.panel.mount(host, props.api);
      if (typeof dispose === 'function') disposers.push(dispose);
    }
  });
  onCleanup(() => {
    for (const dispose of disposers) dispose();
  });

  return (
    <section class="mvp-sim" data-screen="sim" role="region" aria-label={t('sim.title')}>
      <div class="mvp-sim__tabs" role="tablist" aria-label={t('sim.tabs.label')}>
        <button
          type="button"
          role="tab"
          class="mvp-sim__tab"
          classList={{ 'is-active': active() === 'help' }}
          data-tab="help"
          aria-selected={active() === 'help'}
          onClick={() => setActive('help')}
        >
          {t('sim.tab.help')}
        </button>
        <For each={tools}>
          {(tool) => (
            <button
              type="button"
              role="tab"
              class="mvp-sim__tab"
              classList={{ 'is-active': active() === tool.id }}
              data-tab={tool.id}
              aria-selected={active() === tool.id}
              onClick={() => setActive(tool.id)}
            >
              {t(tool.labelKey)}
            </button>
          )}
        </For>
      </div>

      <div class="mvp-sim__body">
        <div
          class="mvp-sim__panel mvp-sim__help"
          classList={{ 'is-hidden': active() !== 'help' }}
          role="tabpanel"
          data-tabpanel="help"
          hidden={active() !== 'help'}
        >
          <h2 class="mvp-sim__help-title">{t('sim.help.title')}</h2>
          <p>{t('sim.help.intro')}</p>
          <ol class="mvp-sim__help-steps">
            <li>{t('sim.help.step.bridge')}</li>
            <li>{t('sim.help.step.connect')}</li>
            <li>{t('sim.help.step.fly')}</li>
          </ol>
        </div>

        <For each={tools}>
          {(tool) => (
            <div
              class="mvp-sim__panel"
              classList={{ 'is-hidden': active() !== tool.id }}
              role="tabpanel"
              data-tabpanel={tool.id}
              hidden={active() !== tool.id}
              ref={(el) => {
                hosts.set(tool.id, el);
              }}
            />
          )}
        </For>
      </div>
    </section>
  );
};
