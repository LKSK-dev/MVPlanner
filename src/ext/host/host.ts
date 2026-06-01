/**
 * Extension host / manager (task T7.1; spec plan/06 §6.2/§6.3).
 *
 * Owns the install → persist → enable/disable → (lazy) activate → reload →
 * uninstall lifecycle for extensions. It is deliberately split from:
 *  - the **runtime** ({@link ExtensionRuntime}) — T7.2 swaps the in-process
 *    runtime for a sandboxed Worker/iframe runtime,
 *  - the **context** ({@link ContextFactory}) — T7.3 provides the real,
 *    permission-brokered {@link ExtContext},
 *  - the **watchdog** ({@link Watchdog}) — T7.2 fills the CPU/loop stub.
 *
 * Activation is lazy: callers fire activation events (`onStartup`, `onConnect`,
 * `onScreen:<id>`, `onCommand:<id>`, `onMessage:<NAME>`) and the host activates
 * matching enabled extensions on first match. Every activation gets a
 * {@link DisposeRegistry}; deactivate/uninstall/reload tear it down. A throwing
 * `activate`/`deactivate` is caught and the extension is marked `'error'`
 * (paused) — it never crashes the host.
 */
import type { ExtContext, ExtManifest, KvStore } from '../../contracts';
import { ExtManifestError, toErrorMessage } from './errors';
import { isApiVersionCompatible, parseManifest } from './manifest';
import { type ActivationEvent, deriveActivationEvents } from './activation';
import { DisposeRegistry } from './dispose';
import { type ExtKvStore, createExtKvStore } from './storage';
import type { ExtLoadRecord, ExtModule, ExtensionRuntime, LoadedExtension } from './runtime';

/** Lifecycle status of a managed extension. */
export type ExtStatus = 'installed' | 'active' | 'disabled' | 'error';

/** Immutable public view of a managed extension. */
export interface ExtState {
  id: string;
  manifest: ExtManifest;
  enabled: boolean;
  status: ExtStatus;
  /** Present only when `status === 'error'`. */
  error?: string;
  activationEvents: ActivationEvent[];
  installedAt: number;
  updatedAt: number;
}

/** Source passed to {@link ExtensionHost.install} / {@link ExtensionHost.reload}. */
export interface InstallSource {
  /** Parsed manifest; if omitted, taken from `module.manifest`. */
  manifest?: ExtManifest;
  /** Raw source persisted for the sandboxed runtime (T7.2). */
  code?: string;
  /** Pre-provided module for the in-process runtime (T7.1). */
  module?: ExtModule;
  /** Override the activation events (else derived from `contributes`). */
  activationEvents?: ActivationEvent[];
  /** Install enabled (default `true`). */
  enabled?: boolean;
}

/** Inputs the host gives a {@link ContextFactory} to build one extension's `ctx`. */
export interface ExtContextInput {
  id: string;
  manifest: ExtManifest;
  dispose: DisposeRegistry;
  storage: ExtKvStore;
}

/** The T7.3 seam: builds the permission-brokered {@link ExtContext}. */
export type ContextFactory = (input: ExtContextInput) => ExtContext;

/** CPU/loop watchdog seam; the no-op default is filled by the sandbox (T7.2). */
export interface Watchdog {
  /** Begin watching an activated extension; returns a stop handle. */
  watch(id: string): () => void;
}

/** Injected dependencies (testable: pass fakes for each). */
export interface ExtensionHostDeps {
  storage: KvStore;
  runtime: ExtensionRuntime;
  createContext: ContextFactory;
  now?: () => number;
  watchdog?: Watchdog;
  /** Base KV namespace (default `'ext'`). */
  namespace?: string;
}

/** Serializable record persisted in the {@link KvStore} (no live module/functions). */
interface PersistedRecord {
  id: string;
  manifest: ExtManifest;
  code: string;
  enabled: boolean;
  activationEvents: ActivationEvent[];
  installedAt: number;
  updatedAt: number;
}

/** In-memory state: the persisted record plus transient runtime handles. */
interface Managed {
  id: string;
  manifest: ExtManifest;
  code: string;
  module?: ExtModule;
  activationEvents: ActivationEvent[];
  enabled: boolean;
  installedAt: number;
  updatedAt: number;
  status: ExtStatus;
  error?: string;
  loaded?: LoadedExtension;
  dispose?: DisposeRegistry;
  stopWatchdog?: () => void;
}

const INDEX_KEY = 'index';
const recordKey = (id: string): string => `record:${id}`;

export class ExtensionHost {
  readonly #deps: ExtensionHostDeps;
  readonly #ns: string;
  readonly #now: () => number;
  readonly #managed = new Map<string, Managed>();

  constructor(deps: ExtensionHostDeps) {
    this.#deps = deps;
    this.#ns = deps.namespace ?? 'ext';
    this.#now = deps.now ?? Date.now;
  }

  /** Hydrate managed state from the {@link KvStore} (call once at startup). */
  async restore(): Promise<void> {
    const index = await this.#loadIndex();
    for (const id of index) {
      const rec = await this.#deps.storage.get<PersistedRecord>(this.#ns, recordKey(id));
      if (!rec) continue;
      this.#managed.set(id, {
        id: rec.id,
        manifest: rec.manifest,
        code: rec.code,
        activationEvents: rec.activationEvents,
        enabled: rec.enabled,
        installedAt: rec.installedAt,
        updatedAt: rec.updatedAt,
        status: rec.enabled ? 'installed' : 'disabled',
      });
    }
  }

  /** Install (or replace) an extension from raw code + parsed manifest / module. */
  async install(source: InstallSource): Promise<ExtState> {
    const manifestInput = source.manifest ?? source.module?.manifest;
    if (manifestInput === undefined) {
      throw new ExtManifestError('install source requires a manifest or a module exporting one');
    }
    const manifest = parseManifest(manifestInput);
    if (!isApiVersionCompatible(manifest.apiVersion)) {
      throw new ExtManifestError(
        `extension "${manifest.id}" requires API "${manifest.apiVersion}", incompatible with host API`,
      );
    }

    const id = manifest.id;
    const ts = this.#now();
    const existing = this.#managed.get(id);
    if (existing && existing.status === 'active') {
      await this.#teardown(existing, 'installed');
    }

    const enabled = source.enabled ?? true;
    const managed: Managed = {
      id,
      manifest,
      code: source.code ?? '',
      activationEvents: source.activationEvents ?? deriveActivationEvents(manifest),
      enabled,
      installedAt: existing?.installedAt ?? ts,
      updatedAt: ts,
      status: enabled ? 'installed' : 'disabled',
      ...(source.module !== undefined ? { module: source.module } : {}),
    };
    this.#managed.set(id, managed);
    await this.#persist(managed);
    return this.#toState(managed);
  }

  /** All managed extensions (snapshot). */
  list(): ExtState[] {
    return [...this.#managed.values()].map((m) => this.#toState(m));
  }

  /** One managed extension, or `undefined`. */
  get(id: string): ExtState | undefined {
    const m = this.#managed.get(id);
    return m ? this.#toState(m) : undefined;
  }

  /** Per-extension scoped KV store (the seam T7.3's `ctx.storage` uses). */
  extStorage(id: string): ExtKvStore {
    return createExtKvStore(this.#deps.storage, `${this.#ns}.data.${id}`);
  }

  /** Enable an extension (does not eagerly activate — activation stays lazy). */
  async enable(id: string): Promise<ExtState> {
    const m = this.#require(id);
    m.enabled = true;
    m.updatedAt = this.#now();
    if (m.status === 'disabled' || m.status === 'error') {
      m.status = 'installed';
      delete m.error;
    }
    await this.#persist(m);
    return this.#toState(m);
  }

  /** Disable an extension, deactivating + tearing it down if active. */
  async disable(id: string): Promise<ExtState> {
    const m = this.#require(id);
    m.enabled = false;
    m.updatedAt = this.#now();
    if (m.status === 'active') {
      await this.#teardown(m, 'disabled');
    } else {
      m.status = 'disabled';
    }
    await this.#persist(m);
    return this.#toState(m);
  }

  /** Uninstall: deactivate, remove the record + index entry, clear its KV. */
  async uninstall(id: string): Promise<void> {
    const m = this.#managed.get(id);
    if (!m) return;
    if (m.status === 'active') {
      await this.#teardown(m, 'installed');
    }
    this.#managed.delete(id);
    await this.#deps.storage.del(this.#ns, recordKey(id));
    const index = (await this.#loadIndex()).filter((x) => x !== id);
    await this.#saveIndex(index);
    await this.extStorage(id).clear();
  }

  /**
   * Hot reload: cleanly deactivate, optionally swap in new source/module, then
   * re-activate if it was active and is still enabled.
   */
  async reload(id: string, source?: InstallSource): Promise<ExtState> {
    const m = this.#require(id);
    const wasActive = m.status === 'active';
    if (wasActive) await this.#teardown(m, 'installed');

    if (source) {
      const manifestInput = source.manifest ?? source.module?.manifest;
      if (manifestInput !== undefined) {
        const manifest = parseManifest(manifestInput);
        if (!isApiVersionCompatible(manifest.apiVersion)) {
          throw new ExtManifestError(
            `extension "${manifest.id}" requires API "${manifest.apiVersion}", incompatible with host API`,
          );
        }
        m.manifest = manifest;
      }
      if (source.code !== undefined) m.code = source.code;
      if (source.module !== undefined) m.module = source.module;
      if (source.activationEvents !== undefined) m.activationEvents = source.activationEvents;
    }

    m.updatedAt = this.#now();
    delete m.error;
    m.status = m.enabled ? 'installed' : 'disabled';
    await this.#persist(m);

    if (wasActive && m.enabled) await this.#activate(m);
    return this.#toState(m);
  }

  /**
   * Fire an activation event; lazily activate every enabled, not-yet-active,
   * non-errored extension registered for it. Returns the states it activated.
   */
  async fireActivationEvent(event: ActivationEvent): Promise<ExtState[]> {
    const activated: ExtState[] = [];
    for (const m of this.#managed.values()) {
      if (!m.enabled) continue;
      if (m.status === 'active' || m.status === 'error') continue;
      if (m.activationEvents.includes(event)) {
        // Only report extensions that actually reached 'active' (error-isolated
        // ones are paused, not activated).
        if (await this.#activate(m)) activated.push(this.#toState(m));
      }
    }
    return activated;
  }

  /** Force-activate an enabled extension now (no-op if already active). */
  async activate(id: string): Promise<ExtState> {
    const m = this.#require(id);
    if (!m.enabled) {
      throw new ExtManifestError(`cannot activate disabled extension "${id}"`);
    }
    await this.#activate(m);
    return this.#toState(m);
  }

  /** Deactivate an active extension (back to `'installed'`). */
  async deactivate(id: string): Promise<ExtState> {
    const m = this.#require(id);
    if (m.status === 'active') {
      await this.#teardown(m, 'installed');
    }
    return this.#toState(m);
  }

  // --- internals -----------------------------------------------------------

  /** Activate `m`; returns whether it reached the `'active'` status. */
  async #activate(m: Managed): Promise<boolean> {
    if (!m.enabled) return false;
    if (m.status === 'active') return true;
    const record: ExtLoadRecord = {
      id: m.id,
      manifest: m.manifest,
      code: m.code,
      ...(m.module !== undefined ? { module: m.module } : {}),
    };
    const dispose = new DisposeRegistry();
    let loaded: LoadedExtension | undefined;
    try {
      loaded = await this.#deps.runtime.load(record);
      const ctx = this.#deps.createContext({
        id: m.id,
        manifest: m.manifest,
        dispose,
        storage: this.extStorage(m.id),
      });
      await loaded.activate(ctx);
      m.loaded = loaded;
      m.dispose = dispose;
      m.status = 'active';
      delete m.error;
      const stop = this.#deps.watchdog?.watch(m.id);
      if (stop) m.stopWatchdog = stop;
      return true;
    } catch (err) {
      // Error isolation: pause this extension, never propagate to the host.
      dispose.dispose();
      if (loaded) {
        try {
          await loaded.dispose();
        } catch {
          /* isolate runtime dispose faults */
        }
      }
      delete m.loaded;
      delete m.dispose;
      delete m.stopWatchdog;
      m.status = 'error';
      m.error = toErrorMessage(err);
      return false;
    }
  }

  async #teardown(m: Managed, target: ExtStatus): Promise<void> {
    const loaded = m.loaded;
    const dispose = m.dispose;
    const stop = m.stopWatchdog;
    delete m.loaded;
    delete m.dispose;
    delete m.stopWatchdog;

    if (stop) {
      try {
        stop();
      } catch {
        /* isolate watchdog stop faults */
      }
    }

    let errored = false;
    if (loaded) {
      try {
        await loaded.deactivate();
      } catch (err) {
        errored = true;
        m.error = toErrorMessage(err);
      }
    }
    if (dispose) dispose.dispose();
    if (loaded) {
      try {
        await loaded.dispose();
      } catch {
        /* isolate runtime dispose faults */
      }
    }
    m.status = errored ? 'error' : target;
    if (!errored) delete m.error;
  }

  async #persist(m: Managed): Promise<void> {
    const rec: PersistedRecord = {
      id: m.id,
      manifest: m.manifest,
      code: m.code,
      enabled: m.enabled,
      activationEvents: m.activationEvents,
      installedAt: m.installedAt,
      updatedAt: m.updatedAt,
    };
    await this.#deps.storage.set<PersistedRecord>(this.#ns, recordKey(m.id), rec);
    const index = await this.#loadIndex();
    if (!index.includes(m.id)) {
      index.push(m.id);
      await this.#saveIndex(index);
    }
  }

  async #loadIndex(): Promise<string[]> {
    return (await this.#deps.storage.get<string[]>(this.#ns, INDEX_KEY)) ?? [];
  }

  async #saveIndex(index: string[]): Promise<void> {
    await this.#deps.storage.set<string[]>(this.#ns, INDEX_KEY, index);
  }

  #require(id: string): Managed {
    const m = this.#managed.get(id);
    if (!m) throw new ExtManifestError(`unknown extension "${id}"`);
    return m;
  }

  #toState(m: Managed): ExtState {
    return {
      id: m.id,
      manifest: m.manifest,
      enabled: m.enabled,
      status: m.status,
      activationEvents: [...m.activationEvents],
      installedAt: m.installedAt,
      updatedAt: m.updatedAt,
      ...(m.error !== undefined ? { error: m.error } : {}),
    };
  }
}
