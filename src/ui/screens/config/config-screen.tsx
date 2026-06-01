/**
 * Config screen assembly (M3 keystone; spec plan/04 §4.5, plan/05 §5.4 Config).
 *
 * A tabbed screen composing the three committed Config sub-panels — Parameters
 * (the {@link createParamWorkbenchPanel} workbench), Tuning (the
 * {@link createTuningPanel} PID tables) and Settings (the
 * {@link createSettingsPanel} app settings + Storage Manager) — over the shared
 * singletons:
 *
 *  - the app/connection-scoped {@link ParamClient} + {@link ParamMetaResolver}
 *    (fetched once, shared by both Parameters and Tuning);
 *  - the {@link CommandClient} for autotune;
 *  - the store (settings + active vehicle) and the storage foundation.
 *
 * Save/Load for the workbench are wired here to the param-file module (T3.5): the
 * sub-panels never import `data/paramfile`. The three sub-panels are mounted ONCE
 * into hidden host containers and toggled by tab so their state (fetched params,
 * staged edits, storage report) survives tab switches; only the active panel is
 * visible. Each sub-panel mounts a fresh Solid root, so the screen never relies
 * on a provider an imperative mount cannot see.
 */
import { For, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import type {
  AppState,
  CommandClient,
  FileIo,
  PanelApi,
  PanelDef,
  Param,
  ParamClient,
  Store,
} from '../../../contracts';
import type { ParamMetaResolver, TFn } from '../../widgets/paramgrid';
import { createParamWorkbenchPanel } from './params';
import { createTuningPanel, type TuningVehicle } from './tuning';
import { createSettingsPanel, type ConfirmFn, type StorageManagerDeps } from './settings';
import { loadParamFile, saveParamFile } from '../../../data/paramfile';
import './messages';

// The Config screen imports every sub-surface's CSS at one site (the sub-panels
// are pure components that do not import their own stylesheets).
import '../../widgets/paramgrid/paramgrid.css';
import './params/workbench.css';
import './tuning/tuning.css';
import './settings/settings.css';
import './config.css';

/** {@link ConfigScreen} props. */
export interface ConfigScreenProps {
  /** Shared parameter microservice client (Parameters + Tuning). */
  paramClient: ParamClient;
  /** Shared metadata resolver (the `ParamMetaStore`). */
  meta: ParamMetaResolver;
  /** Command microservice for autotune (omit to hide autotune controls). */
  command?: CommandClient;
  /** The shared app store (settings + active vehicle). */
  store: Store<AppState>;
  /** Storage `FileIo` for `.param` load/save (workbench Save/Compare). */
  files: FileIo;
  /** Injected Storage Manager handles for the Settings tab. */
  storageManager: StorageManagerDeps;
  /** Safety-confirm seam for the Settings factory reset (the shell `confirm`). */
  confirm?: ConfirmFn;
  /** The host panel's {@link PanelApi} (threaded to the sub-panel mounts). */
  api: PanelApi;
  /** i18n translate function. */
  t: TFn;
}

/** One Config tab: id, i18n label key and its {@link PanelDef}. */
interface ConfigTab {
  readonly id: string;
  readonly labelKey: string;
  readonly panel: PanelDef;
}

/**
 * Load a comparison set for the workbench diff drawer from a `.param` file: the
 * picker returns a `name -> value` record (an empty record when cancelled).
 */
function makeOnLoad(files: FileIo): () => Promise<Record<string, number>> {
  return async (): Promise<Record<string, number>> => {
    const loaded = await loadParamFile(files);
    if (loaded === undefined) return {};
    const out: Record<string, number> = {};
    for (const entry of loaded.params) out[entry.name] = entry.value;
    return out;
  };
}

/** The composed tabbed Config screen. */
export const ConfigScreen: Component<ConfigScreenProps> = (props) => {
  const t = props.t;

  // Reactive active vehicle for the Tuning tab: () => store.vehicles[activeSysid].
  const vehicle = props.store.select<TuningVehicle | undefined>((s) => {
    if (s.activeSysid === undefined) return undefined;
    return s.vehicles[s.activeSysid];
  });

  const tabs: readonly ConfigTab[] = [
    {
      id: 'params',
      labelKey: 'config.tab.params',
      panel: createParamWorkbenchPanel({
        client: props.paramClient,
        meta: props.meta,
        t,
        onSave: (params: Param[]) => saveParamFile(props.files, params),
        onLoad: makeOnLoad(props.files),
      }),
    },
    {
      id: 'tuning',
      labelKey: 'config.tab.tuning',
      panel: createTuningPanel({
        client: props.paramClient,
        meta: props.meta,
        vehicle,
        t,
        ...(props.command !== undefined ? { command: props.command } : {}),
      }),
    },
    {
      id: 'settings',
      labelKey: 'config.tab.settings',
      panel: createSettingsPanel({
        store: props.store,
        storage: props.storageManager,
        ...(props.confirm !== undefined ? { confirm: props.confirm } : {}),
      }),
    },
  ];

  const [active, setActive] = createSignal<string>(tabs[0]?.id ?? '');

  const hosts = new Map<string, HTMLElement>();
  const disposers: Array<() => void> = [];

  onMount(() => {
    for (const tab of tabs) {
      const host = hosts.get(tab.id);
      if (host === undefined) continue;
      const dispose = tab.panel.mount(host, props.api);
      if (typeof dispose === 'function') disposers.push(dispose);
    }
  });
  onCleanup(() => {
    for (const dispose of disposers) dispose();
  });

  return (
    <section class="mvp-config" data-screen="config" role="region" aria-label={t('config.title')}>
      <div class="mvp-config__tabs" role="tablist" aria-label={t('config.tabs.label')}>
        <For each={tabs}>
          {(tab) => (
            <button
              type="button"
              role="tab"
              class="mvp-config__tab"
              classList={{ 'is-active': active() === tab.id }}
              data-tab={tab.id}
              aria-selected={active() === tab.id}
              onClick={() => setActive(tab.id)}
            >
              {t(tab.labelKey)}
            </button>
          )}
        </For>
      </div>

      <div class="mvp-config__body">
        <For each={tabs}>
          {(tab) => (
            <div
              class="mvp-config__panel"
              classList={{ 'is-hidden': active() !== tab.id }}
              role="tabpanel"
              data-tabpanel={tab.id}
              hidden={active() !== tab.id}
              ref={(el) => {
                hosts.set(tab.id, el);
              }}
            />
          )}
        </For>
      </div>
    </section>
  );
};
