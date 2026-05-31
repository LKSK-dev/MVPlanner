import { type Component } from 'solid-js';
import type { Capabilities } from './core/capabilities';
import { detectRealCapabilities } from './core/capabilities';
import { createAppStore } from './core/store';
import { t } from './core/i18n';
import { createStorage } from './data/storage';
import { Shell, createUiRegistry, type ShellContextValue } from './ui/shell';
import './ui/shell/shell.css';

/** Optional injection points (used by tests; real singletons by default). */
export interface AppProps {
  /** Override capability detection (defaults to {@link detectRealCapabilities}). */
  capabilities?: Capabilities;
}

/**
 * Application root (T0.7). Constructs the singleton {@link Store} (persisting
 * settings/layout to IndexedDB via `data/storage`), the shell {@link UiRegistry}
 * and the capability record, bundles them into the {@link ShellContextValue} and
 * renders the {@link Shell}. The shell itself wires settings → theme/locale and
 * registers the six screens (see `ui/shell`).
 */
export const App: Component<AppProps> = (props) => {
  const storage = createStorage();
  const store = createAppStore(undefined, storage.kv);
  const registry = createUiRegistry();
  const capabilities = props.capabilities ?? detectRealCapabilities();

  const ctx: ShellContextValue = {
    store,
    registry,
    capabilities,
    panelApi: { store, t },
  };

  return <Shell ctx={ctx} />;
};
