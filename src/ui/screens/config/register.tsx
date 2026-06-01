/**
 * Registration glue for the Config screen (M3 keystone; spec plan/05 §5.2
 * registration, §5.4 Config).
 *
 * Builds the REAL `screen.config` {@link PanelDef} that mounts {@link ConfigScreen}
 * with the shared singletons. {@link App} installs it through
 * {@link import('../../shell').setScreenPanel} BEFORE the shell renders, so the
 * dock mounts the real Config screen over the placeholder.
 *
 * This is the integration site that assembles the Storage Manager handles
 * ({@link StorageManagerDeps}) from the storage foundation: a tile-cache clear, a
 * browser usage estimate, a factory-reset that closes the database then deletes
 * it, and a `saveAs` export. The param-file Save/Load wiring lives in
 * {@link ConfigScreen}.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type {
  AppState,
  CommandClient,
  PanelApi,
  PanelDef,
  ParamClient,
  Store,
} from '../../../contracts';
import { screenPanelId, type ShellRegistry } from '../../shell';
import { createTileCache } from '../../widgets/map';
import type { ParamMetaResolver, TFn } from '../../widgets/paramgrid';
import { type AppStorage, DB_NAME } from '../../../data/storage';
import {
  browserStorageEstimate,
  type NetworkSectionDeps,
  type StorageManagerDeps,
} from './settings';
import { ConfigScreen } from './config-screen';
import './messages';

/** Stable panel id for the Config screen (`screen.config`). */
export const CONFIG_SCREEN_PANEL_ID = screenPanelId('config');

/** Construction dependencies for the Config screen panel. */
export interface ConfigScreenPanelDeps {
  /** Shared parameter microservice client (Parameters + Tuning). */
  readonly paramClient: ParamClient;
  /** Shared metadata resolver (the `ParamMetaStore`). */
  readonly meta: ParamMetaResolver;
  /** Command microservice for autotune (omit to hide autotune controls). */
  readonly command?: CommandClient;
  /** The shared app store (settings + active vehicle). */
  readonly store: Store<AppState>;
  /** The storage foundation (files, blobs, close/estimate for Storage Manager). */
  readonly storage: AppStorage;
  /** The shell registry (for the `confirm` seam). */
  readonly registry: ShellRegistry;
  /** Settings → Network egress-transparency sources (spec plan/07 §7.7); optional. */
  readonly network?: NetworkSectionDeps;
  /** i18n translate function. */
  readonly t: TFn;
}

/** Wrap the platform `fetch` for the tile cache's injected fetch seam. */
function platformFetch(url: string, init?: { signal?: AbortSignal }): Promise<Response> {
  return fetch(url, init);
}

/** Delete the IndexedDB database `name`, resolving on success/blocked. */
function deleteDatabase(name: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = (): void => resolve();
    req.onblocked = (): void => resolve();
    req.onerror = (): void => reject(req.error ?? new Error(`deleteDatabase(${name}) failed`));
  });
}

/**
 * Build the Storage Manager handles for the Settings tab from the storage
 * foundation: a tile-cache clear (over the `blobs` namespace), a usage estimate
 * (when the browser supports it), a factory reset (close + delete the database)
 * and a `saveAs` export.
 */
function buildStorageManager(storage: AppStorage): StorageManagerDeps {
  const tileCache = createTileCache({ blobs: storage.blobs, fetch: platformFetch });
  const estimate = browserStorageEstimate();
  return {
    blobs: storage.blobs,
    clearTileCache: () => tileCache.clear(),
    clearAllData: async (): Promise<void> => {
      await storage.close();
      await deleteDatabase(DB_NAME);
    },
    saveFile: (data, suggestedName) => storage.files.saveAs(data, suggestedName),
    ...(estimate !== undefined ? { estimate } : {}),
  };
}

/** Build the real `screen.config` {@link PanelDef} bound to the singletons. */
export function createConfigScreenPanel(deps: ConfigScreenPanelDeps): PanelDef {
  const storageManager = buildStorageManager(deps.storage);
  return {
    id: CONFIG_SCREEN_PANEL_ID,
    title: deps.t('nav.config'),
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(ConfigScreen, {
            paramClient: deps.paramClient,
            meta: deps.meta,
            store: deps.store,
            files: deps.storage.files,
            storageManager,
            confirm: (opts) => deps.registry.confirm(opts),
            api,
            t: api.t,
            ...(deps.command !== undefined ? { command: deps.command } : {}),
            ...(deps.network !== undefined ? { network: deps.network } : {}),
          }),
        el,
      );
    },
  };
}
