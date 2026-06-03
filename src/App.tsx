import { createEffect, createSignal, onCleanup, type Accessor, type Component } from 'solid-js';
import type { Capabilities } from './core/capabilities';
import { detectRealCapabilities } from './core/capabilities';
import { createAppStore } from './core/store';
import { t } from './core/i18n';
import { createStorage } from './data/storage';
import {
  createSecretStore,
  SECRET_MAP_API_KEY,
  SecretsCryptoUnavailableError,
  type SecretStore,
} from './core/secrets';
import { Shell, createUiRegistry, setScreenPanel, type ShellContextValue } from './ui/shell';
import { registerAbout } from './ui/shell/about';
import { ConnectionProvider } from './ui/shell/connection';
import { MavlinkHost } from './mavlink/host';
import type { MavlinkHostLike } from './transport/manager';
import { registerInspector } from './ui/widgets/inspector/register';
import type { InspectorSource } from './ui/widgets/inspector/types';
import {
  createFlightServices,
  createFlightScreenPanel,
  wireAudioAlerts,
  type FlightHost,
} from './ui/screens/flight';
import {
  createConfigScreenPanel,
  buildStorageManager,
  createEgressLog,
  type EgressLog,
  type LinkDestination,
  type NetGrantRow,
  type NetworkSectionDeps,
} from './ui/screens/config';
import {
  AppSettingsContext,
  AppSettingsPane,
  buildAppSettingsSections,
  createAppSettingsControl,
  createLiveKeybinds,
  type AppSettingsSectionDeps,
} from './ui/shell/appsettings';
import { createRecentsStore, type RecentEntry, type RecentKind } from './core/recents';
import {
  SHELL_LAYOUT_KEY,
  activateWorkspace,
  migrateShellLayout,
  readShellLayout,
  writeShellLayout,
} from './ui/shell/workspace';
import { SCREEN_ORDER } from './ui/shell/screens';
import { defaultLayout, ensurePresets } from './ui/shell/presets';
import './ui/shell/appsettings/appsettings.css';
import type { AppState, KvStore, Store } from './contracts';
import { createPlanScreenPanel, createPlanSession } from './ui/screens/plan';
import { createSetupScreenPanel, wireTracker } from './ui/screens/setup';
import { createForwardController, type ForwardController } from './ui/shell/connection';
import { createAudioAlertService } from './core/audio';
import { createLogsScreenPanel } from './ui/screens/logs';
import {
  createExtServices,
  createInstallPromptController,
  createSimDevTools,
  InstallPromptHost,
  type ExtensionsController,
  type InstallPromptController,
} from './ui/screens/sim';
import { createEventsBus, createExtensionSystem, type ExtensionSystem } from './ext/api';
import { examples } from '../extensions/index.js';
import './ui/shell/shell.css';
import './ui/shell/connection/connection.css';
import './ui/widgets/inspector/inspector.css';

/** Optional injection points (used by tests; real singletons by default). */
export interface AppProps {
  /** Override capability detection (defaults to {@link detectRealCapabilities}). */
  capabilities?: Capabilities;
  /**
   * Override the MAVLink host (defaults to a real {@link MavlinkHost}, which
   * owns the inlined worker). Tests inject a mock host so no Worker is spun.
   */
  host?: MavlinkHostLike;
}

/**
 * Application root (T0.7 / T1.10). Constructs the singleton {@link Store}
 * (persisting settings/layout to IndexedDB via `data/storage`), the shell
 * {@link UiRegistry}, the capability record and the singleton MAVLink
 * {@link MavlinkHost}, bundles the shell deps into the {@link ShellContextValue}
 * and renders the {@link Shell} wrapped in the {@link ConnectionProvider}.
 *
 * The provider owns the {@link import('./transport/manager').ConnectionManager},
 * pushes live connection/vehicle state into the same `store`, registers the
 * `Connect / Disconnect` command, and mounts the connection drawer — so the
 * top-bar status chips light up once a link is established. The host (and its
 * worker) is disposed when the provider unmounts.
 */
export const App: Component<AppProps> = (props) => {
  const storage = createStorage();
  const store = createAppStore(undefined, storage.kv);
  const registry = createUiRegistry();
  const capabilities = props.capabilities ?? detectRealCapabilities();
  const host: MavlinkHostLike = props.host ?? new MavlinkHost();
  onCleanup(registerAbout(registry, t));

  // --- App Settings pane: recents, storage-manager, keybind bridge, control --
  const recents = createRecentsStore({ kv: storage.kv, blobs: storage.blobs });
  void recents.load();
  // App-lifetime plan session so the in-progress plan survives Plan-tab switches.
  const planSession = createPlanSession();

  // UI remake: ensure the six built-in workspace presets exist (migrating any
  // older/foreign stored layout, never crashing), and point the active
  // workspace at the current screen. Idempotent + reactive (re-runs once after
  // the KV rehydrates the persisted layout).
  const wsNameFor = (id: string): string => t(`nav.${id}`);
  const shellLayoutSel = store.select((s) => readShellLayout(s.layout, t('workspace.default')));
  createEffect(() => {
    const shell = shellLayoutSel();
    const complete =
      SCREEN_ORDER.every((id) => shell.workspaces[id] !== undefined) &&
      shell.workspaces[shell.activeWorkspaceId] !== undefined;
    if (complete) return;
    store.patch((s) => {
      const migrated = migrateShellLayout(
        s.layout.workspaces[SHELL_LAYOUT_KEY],
        defaultLayout(wsNameFor),
      );
      writeShellLayout(
        s.layout,
        activateWorkspace(ensurePresets(migrated, wsNameFor), s.layout.activeScreen),
      );
    });
  });
  const storageManager = buildStorageManager(storage);
  const appSettingsControl = createAppSettingsControl(
    store.get().settings.appearance?.lastSettingsSection ?? 'appearance',
  );
  // Remember the active section across opens (only while the pane is in use).
  createEffect(() => {
    if (!appSettingsControl.isOpen()) return;
    const sec = appSettingsControl.section();
    store.patch((d) => {
      d.settings.appearance = { ...d.settings.appearance, lastSettingsSection: sec };
    });
  });
  const liveKeybinds = createLiveKeybinds(() => registry.commands(), store);
  const [keybindCapturing, setKeybindCapturing] = createSignal(false);
  onCleanup(
    registry.registerCommand({
      id: 'app.settings.open',
      title: t('appsettings.open'),
      shortcut: 'shift+s',
      run: () => appSettingsControl.toggle(),
    }),
  );
  const appSettingsSections = buildAppSettingsSections();
  let paneNetwork: NetworkSectionDeps | undefined;
  let paneExtensions: ExtensionsController | undefined;
  // Pending Recents “Open”: a cached blob loaded from the recents store, handed
  // to the owning screen (Plan / Logs) which loads it and clears it via
  // `onPendingConsumed`. Filtered per-screen by kind below.
  const [pendingOpen, setPendingOpen] = createSignal<
    { kind: RecentKind; name: string; blob: Blob } | undefined
  >();
  const planPendingOpen: Accessor<{ name: string; blob: Blob } | undefined> = () => {
    const p = pendingOpen();
    return p !== undefined && p.kind === 'plan' ? { name: p.name, blob: p.blob } : undefined;
  };
  const logsPendingOpen: Accessor<{ name: string; blob: Blob } | undefined> = () => {
    const p = pendingOpen();
    return p !== undefined && (p.kind === 'log' || p.kind === 'tlog')
      ? { name: p.name, blob: p.blob }
      : undefined;
  };
  const clearPendingOpen = (): void => {
    setPendingOpen(undefined);
  };
  // Open a recent item: load its cached content (when present) into the pending
  // signal, navigate to the owning screen so that screen consumes + loads it,
  // and close the pane. With no cached blob this is navigate-only (prior
  // behavior) so the row's picker fallback still applies.
  const openRecentImpl = async (entry: RecentEntry): Promise<void> => {
    const owningScreen: AppState['layout']['activeScreen'] =
      entry.kind === 'log' || entry.kind === 'tlog'
        ? 'logs'
        : entry.kind === 'param'
          ? 'config'
          : 'plan';
    const loaded = await recents.open(entry.id);
    if (loaded !== undefined) {
      setPendingOpen({ kind: entry.kind, name: loaded.name, blob: loaded.blob });
    }
    store.patch((d) => {
      d.layout.activeScreen = owningScreen;
    });
    appSettingsControl.close();
  };

  // T1.12 integration: register the MAVLink inspector panel + ⌘K command bound to
  // the singleton host's on-demand inspector stream. Guarded so a test mock host
  // (MavlinkHostLike without subscribeInspector) simply omits the inspector.
  const inspectorSource = host as Partial<InspectorSource>;
  if (typeof inspectorSource.subscribeInspector === 'function') {
    registerInspector(registry, inspectorSource as InspectorSource, t);
  }

  // T2.11 integration: construct the app/connection-scoped Flight services ONCE
  // (so recording/audit/STATUSTEXT survive screen switches) and install the real
  // `flight` screen panel over the shell placeholder BEFORE the shell renders.
  // Guarded so a test mock host (a bare `MavlinkHostLike` without the selective
  // `onMessage`/`onRawFrame` taps) simply leaves the Flight placeholder in place.
  let installPrompt: InstallPromptController | undefined;
  let forwarder: ForwardController | undefined;
  if (isFlightHost(host)) {
    const flight = createFlightServices({ host, store, storage });
    const disposeFlightPanel = setScreenPanel(
      'flight',
      createFlightScreenPanel({ services: flight.services, store, registry, t }),
    );
    // M3 keystone: install the real Config screen (Parameters | Tuning |
    // Settings) over its placeholder, sharing the app-scoped ParamClient /
    // ParamMetaStore + the CommandClient (autotune) from the same services.
    // T8.12 security: the encrypted-at-rest secret store (WebCrypto), the egress
    // log (the broker `recordEgress` sink) and the Settings -> Network sources.
    const secrets = createAppSecretStore(storage.kv);
    const egressLog = createEgressLog();
    const networkDeps = buildNetworkDeps({ store, egress: egressLog, getSystem: () => extSystem });
    paneNetwork = networkDeps;

    const disposeConfigPanel = setScreenPanel(
      'config',
      createConfigScreenPanel({
        paramClient: flight.services.param,
        meta: flight.services.paramMeta,
        command: flight.services.command,
        store,
        storage,
        registry,
        t,
      }),
    );
    // M4 keystone: install the real Plan screen (map + waypoint table + tool
    // rail + fence/rally/survey drawer + terrain profile + upload/download)
    // over its placeholder, sharing the app-scoped MissionClient / ParamClient /
    // terrain provider + file I/O from the same services.
    const disposePlanPanel = setScreenPanel(
      'plan',
      createPlanScreenPanel({
        services: flight.services,
        t,
        store,
        recents,
        pendingOpen: planPendingOpen,
        onPendingConsumed: clearPendingOpen,
        session: planSession,
      }),
    );
    // M5 keystone: install the real Setup screen (frame/accel/compass/radio/
    // modes/failsafe/battery/motors wizard) over its placeholder, sharing the
    // app-scoped CalibrationClient / ParamClient / CommandClient + the shell
    // `confirm` seam (motor-test gating) from the same services.
    const disposeSetupPanel = setScreenPanel(
      'setup',
      createSetupScreenPanel({
        calibration: flight.services.calibration,
        param: flight.services.param,
        command: flight.services.command,
        store,
        registry,
        t,
      }),
    );
    // M6 keystone: install the real Logs screen (source picker + plotter +
    // map track + inspector + message sender + tlog playback + CSV export)
    // over its placeholder. The DataFlash decode runs OFF the main thread in
    // the inlined log worker; the message sender binds to the host send seam
    // and the inspector to the same on-demand inspector stream.
    const disposeLogsPanel = setScreenPanel(
      'logs',
      createLogsScreenPanel({
        files: storage.files,
        blobs: storage.blobs,
        send: (name, fields) => host.sendMessage(name, fields),
        t,
        store,
        recents,
        pendingOpen: logsPendingOpen,
        onPendingConsumed: clearPendingOpen,
        ...(typeof inspectorSource.subscribeInspector === 'function'
          ? { inspectorSource: inspectorSource as InspectorSource }
          : {}),
      }),
    );
    // M7 keystone: build the extension API ports from the real app-scoped
    // services, instantiate the ONE extension system over them (trusted
    // in-process runtime; the bundled examples carry modules), and wire the
    // Sim & Dev Tools hub (Extensions Manager + Scripting Console + API
    // Reference) over the `sim` placeholder. The install prompt is rendered at
    // the app root so it works from any screen + during example load.
    const extServices = createExtServices({
      host,
      store,
      command: flight.services.command,
      params: flight.services.param,
      mission: flight.services.mission,
      registry,
      files: storage.files,
    });
    const extEvents = createEventsBus();
    const promptController = createInstallPromptController();
    installPrompt = promptController;
    const extSystem = createExtensionSystem({
      storage: storage.kv,
      services: extServices.services,
      confirm: (opts) => registry.confirm(opts),
      audit: flight.services.audit,
      events: extEvents,
      // T8.12: record every brokered extension egress for Settings -> Network.
      recordEgress: (info) => egressLog.record(info),
    });
    const simTools = createSimDevTools({
      system: extSystem,
      services: extServices.services,
      events: extEvents,
      prompt: promptController.prompt,
      files: storage.files,
      storage: storage.kv,
      registry,
      store,
      t,
      examples,
    });
    void simTools.ready();
    // Share the SAME extensions controller with the App Settings -> Extensions
    // section so installs/grants stay in sync across the pane and the Sim hub.
    paneExtensions = simTools.manager;

    // T8.7 voice/audio alerts: one app/connection-scoped service driven by
    // active-vehicle telemetry transitions + STATUSTEXT; settings persist to the
    // storage KV and the app-wide `settings.audioAlerts` toggle gates output.
    const audioService = createAudioAlertService({ store: storage.kv });
    void audioService.loadSettings();
    const disposeAudio = wireAudioAlerts({ service: audioService, host, store });

    // T8.9 antenna tracker: reachable as a dockable panel + ⌘K command, bound to
    // the host send/onMessage taps, the active vehicle and the shared ParamClient.
    // T8.12: route the map/tile provider API key through the encrypted secret
    // store (write-through on change; hydrate the in-memory store on startup).
    const disposeMapKeySecret = wireMapApiKeySecret({ store, secrets });

    const disposeTracker = wireTracker({
      host,
      getActiveVehicle: () => {
        const s = store.get();
        return s.activeSysid === undefined ? undefined : s.vehicles[s.activeSysid];
      },
      param: flight.services.param,
      registry,
      t,
    });

    // T8.5 MAVLink forwarding: a controller over the host raw-frame tap, surfaced
    // through the connection drawer's forwarding control.
    forwarder = createForwardController({ host });

    onCleanup(() => {
      disposeMapKeySecret();
      disposeAudio();
      disposeTracker();
      forwarder?.dispose();
      disposeFlightPanel();
      disposeConfigPanel();
      disposePlanPanel();
      disposeSetupPanel();
      disposeLogsPanel();
      simTools.dispose();
      extSystem.dispose();
      extServices.dispose();
      void flight.dispose();
    });
  }

  const ctx: ShellContextValue = {
    store,
    registry,
    capabilities,
    panelApi: { store, t },
    keybinds: liveKeybinds.registry,
    keybindCapturing,
  };

  const paneDeps: AppSettingsSectionDeps = {
    store,
    t,
    files: storage.files,
    recents,
    keybinds: liveKeybinds.registry,
    persistKeybinds: liveKeybinds.persist,
    setKeybindCapturing,
    storage: storageManager,
    confirm: (opts) => registry.confirm(opts),
    registry,
    setSection: appSettingsControl.setSection,
    close: appSettingsControl.close,
    openRecent: openRecentImpl,
    ...(paneNetwork !== undefined ? { network: paneNetwork } : {}),
    ...(paneExtensions !== undefined ? { extensions: paneExtensions } : {}),
  };

  return (
    <AppSettingsContext.Provider value={appSettingsControl}>
      <ConnectionProvider
        store={store}
        registry={registry}
        host={host}
        {...(forwarder !== undefined ? { forwarder } : {})}
      >
        <Shell ctx={ctx} />
        <AppSettingsPane
          control={appSettingsControl}
          sections={appSettingsSections}
          deps={paneDeps}
        />
        {installPrompt !== undefined ? (
          <InstallPromptHost controller={installPrompt} t={t} />
        ) : null}
      </ConnectionProvider>
    </AppSettingsContext.Provider>
  );
};

/**
 * Narrow a {@link MavlinkHostLike} to the richer {@link FlightHost} the Flight
 * services need (selective decoded-message + never-dropped raw-frame taps). The
 * real {@link MavlinkHost} satisfies it; a bare test mock does not.
 */
function isFlightHost(host: MavlinkHostLike): host is MavlinkHostLike & FlightHost {
  const candidate = host as Partial<FlightHost>;
  return typeof candidate.onMessage === 'function' && typeof candidate.onRawFrame === 'function';
}

/**
 * Build the app's encrypted-at-rest {@link SecretStore} over the storage KV and
 * kick off a best-effort default (empty-passphrase) unlock (T8.12; spec plan/07
 * §7.7). Returns `undefined` when WebCrypto is unavailable (non-secure context),
 * so the wiring degrades to a no-op rather than ever storing plaintext.
 */
function createAppSecretStore(kv: KvStore): SecretStore | undefined {
  try {
    const secrets = createSecretStore({ storage: kv });
    void secrets.unlock().catch(() => undefined);
    return secrets;
  } catch (err) {
    if (err instanceof SecretsCryptoUnavailableError) return undefined;
    throw err;
  }
}

/**
 * Route the map/tile provider API key through the encrypted {@link SecretStore}
 * (T8.12). On startup the encrypted key hydrates the in-memory store (when the
 * plaintext field is empty); a reactive effect write-through-persists every
 * later change. The in-memory `settings.mapSource.apiKey` (consumed by the map)
 * stays as-is. A no-op dispose is returned (the effect is owned by the App root).
 */
function wireMapApiKeySecret(deps: {
  store: Store<AppState>;
  secrets: SecretStore | undefined;
}): () => void {
  const secrets = deps.secrets;
  const noop = (): void => undefined;
  if (secrets === undefined) return noop;

  void (async (): Promise<void> => {
    if (secrets.isLocked()) return;
    const current = deps.store.get().settings.mapSource?.apiKey;
    if (current !== undefined && current !== '') return;
    const stored = await secrets.getString(SECRET_MAP_API_KEY).catch(() => undefined);
    if (stored === undefined || stored === '') return;
    deps.store.patch((draft) => {
      const url = draft.settings.mapSource?.urlTemplate ?? '';
      draft.settings.mapSource = { urlTemplate: url, apiKey: stored };
    });
  })();

  const apiKey = deps.store.select((s) => s.settings.mapSource?.apiKey);
  createEffect(() => {
    const key = apiKey();
    if (secrets.isLocked()) return;
    if (key === undefined || key === '') {
      void secrets.clear(SECRET_MAP_API_KEY).catch(() => undefined);
    } else {
      void secrets.set(SECRET_MAP_API_KEY, key).catch(() => undefined);
    }
  });
  return noop;
}

/**
 * Assemble the Settings -> Network egress-transparency sources (T8.12; spec
 * plan/07 §7.7): the live egress log, the active-link presence (reactive from
 * the connection state) and the extension `net:<host>` grants (read lazily from
 * the extension system).
 */
function buildNetworkDeps(deps: {
  store: Store<AppState>;
  egress: EgressLog;
  getSystem: () => ExtensionSystem;
}): NetworkSectionDeps {
  const connection = deps.store.select((s) => s.connection);
  const links = (): readonly LinkDestination[] =>
    connection().kind === 'open'
      ? [{ kind: 'mavlink', label: t('settings.network.links.active') }]
      : [];
  const netGrants = async (): Promise<readonly NetGrantRow[]> => {
    const system = deps.getSystem();
    const rows: NetGrantRow[] = [];
    for (const state of system.host.list()) {
      const perms = await system.grants.list(state.id);
      for (const perm of perms) {
        if (perm.startsWith('net:'))
          rows.push({ extId: state.id, host: perm.slice('net:'.length) });
      }
    }
    return rows;
  };
  return { egress: deps.egress, links, netGrants };
}
