import { type Component } from 'solid-js';
import type { Capabilities } from './core/capabilities';
import { detectRealCapabilities } from './core/capabilities';
import { createAppStore } from './core/store';
import { t } from './core/i18n';
import { createStorage } from './data/storage';
import { Shell, createUiRegistry, type ShellContextValue } from './ui/shell';
import { ConnectionProvider } from './ui/shell/connection';
import { MavlinkHost } from './mavlink/host';
import type { MavlinkHostLike } from './transport/manager';
import './ui/shell/shell.css';
import './ui/shell/connection/connection.css';

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

  const ctx: ShellContextValue = {
    store,
    registry,
    capabilities,
    panelApi: { store, t },
  };

  return (
    <ConnectionProvider store={store} registry={registry} host={host}>
      <Shell ctx={ctx} />
    </ConnectionProvider>
  );
};
