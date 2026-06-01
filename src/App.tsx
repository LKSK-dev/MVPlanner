import { onCleanup, type Component } from 'solid-js';
import type { Capabilities } from './core/capabilities';
import { detectRealCapabilities } from './core/capabilities';
import { createAppStore } from './core/store';
import { t } from './core/i18n';
import { createStorage } from './data/storage';
import { Shell, createUiRegistry, setScreenPanel, type ShellContextValue } from './ui/shell';
import { ConnectionProvider } from './ui/shell/connection';
import { MavlinkHost } from './mavlink/host';
import type { MavlinkHostLike } from './transport/manager';
import { registerInspector } from './ui/widgets/inspector/register';
import type { InspectorSource } from './ui/widgets/inspector/types';
import {
  createFlightServices,
  createFlightScreenPanel,
  type FlightHost,
} from './ui/screens/flight';
import { createConfigScreenPanel } from './ui/screens/config';
import { createPlanScreenPanel } from './ui/screens/plan';
import { createSetupScreenPanel } from './ui/screens/setup';
import { createLogsScreenPanel } from './ui/screens/logs';
import {
  createExtServices,
  createInstallPromptController,
  createSimDevTools,
  InstallPromptHost,
  type InstallPromptController,
} from './ui/screens/sim';
import { createEventsBus, createExtensionSystem } from './ext/api';
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
  if (isFlightHost(host)) {
    const flight = createFlightServices({ host, store, storage });
    const disposeFlightPanel = setScreenPanel(
      'flight',
      createFlightScreenPanel({ services: flight.services, store, registry, t }),
    );
    // M3 keystone: install the real Config screen (Parameters | Tuning |
    // Settings) over its placeholder, sharing the app-scoped ParamClient /
    // ParamMetaStore + the CommandClient (autotune) from the same services.
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
      createPlanScreenPanel({ services: flight.services, t }),
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

    onCleanup(() => {
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
  };

  return (
    <ConnectionProvider store={store} registry={registry} host={host}>
      <Shell ctx={ctx} />
      {installPrompt !== undefined ? <InstallPromptHost controller={installPrompt} t={t} /> : null}
    </ConnectionProvider>
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
