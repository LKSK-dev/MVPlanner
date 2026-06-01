/**
 * Extension system factory (task T7.3; spec plan/06 §6.2–§6.6).
 *
 * {@link createExtensionSystem} is the single object App instantiates to enable
 * extensions: it ties the {@link ExtensionHost} (install/enable/activate
 * lifecycle), the {@link PermissionBroker} (with every privileged method
 * registered by {@link registerExtApi}), the grant store, and a runtime —
 * either the sandboxed Worker runtime (pass a {@link GuestSpawner}) or the
 * trusted in-process runtime (default) whose `ctx` is the brokered
 * {@link assembleExtContext}. All services + clocks are injected so the system
 * is fully unit-testable.
 *
 * Grants are async (KV-backed) but the host's {@link ContextFactory} is
 * synchronous, so the system pre-resolves a grant snapshot for an extension
 * immediately before activating it; the snapshot drives which `ctx.*` groups are
 * present (spec plan/06 §6.5).
 */
import type { KvStore, Permission } from '../../contracts';
import { type AuditLog, createAuditLog } from '../../core/audit';
import { EXT_API_VERSION } from '../../version';
import {
  type ActivationEvent,
  type ContextFactory,
  type DisposeRegistry,
  type ExtLoadRecord,
  type ExtState,
  ExtensionHost,
  type ExtensionRuntime,
  type InstallSource,
  type LoadedExtension,
  createInProcessRuntime,
} from '../host';
import {
  type ConfirmFn,
  type EgressRecord,
  type GrantStore,
  type PermissionBroker,
  createGrantStore,
  createPermissionBroker,
} from '../permissions';
import { type GuestSpawner, type SandboxWatchdogConfig, createSandboxRuntime } from '../sandbox';
import { assembleExtContext } from './context';
import { type EventsBus, createEventsBus } from './locals';
import type { ExtApiServices } from './ports';
import { registerExtApi } from './register';

/** Injected dependencies for {@link createExtensionSystem}. */
export interface ExtensionSystemDeps {
  /** KV store backing persisted installs + grants. */
  storage: KvStore;
  /** The real services the extension API wraps. */
  services: ExtApiServices;
  /** Armed-aware confirmation for vehicle-affecting calls (shell `confirm`). */
  confirm: ConfirmFn;
  /** Action audit log; a fresh in-memory one is created if omitted. */
  audit?: AuditLog;
  /** Sink for recorded network egress (Settings → Network; spec plan/07 §7.7). */
  recordEgress?: (info: EgressRecord) => void;
  /** `ctx.version`; defaults to {@link EXT_API_VERSION}. */
  version?: string;
  /** Shared inter-extension event bus; one is created if omitted. */
  events?: EventsBus;
  /**
   * Provide a {@link GuestSpawner} to run extensions SANDBOXED (the guest proxy
   * is the privileged surface, reached over the broker). Omit to use the trusted
   * in-process runtime, whose `ctx` is the brokered {@link assembleExtContext}.
   */
  spawn?: GuestSpawner;
  /** Sandbox CPU/loop watchdog (only with `spawn`). */
  watchdog?: SandboxWatchdogConfig;
  /** Notified when a sandboxed guest is force-terminated. */
  onTerminated?: (id: string, reason: string) => void;
  /** Base KV namespace for the host (default `'ext'`). */
  namespace?: string;
  /** Clock for the host (deterministic tests). */
  now?: () => number;
}

/**
 * Install request: the host {@link InstallSource} plus an additive,
 * session-scoped `trusted` flag (T8.12). `trusted: true` runs the extension in
 * the TRUSTED in-process runtime (bundled first-party examples carry a module);
 * the default (`false`) runs imported/untrusted extensions through the SANDBOX
 * runtime when a {@link GuestSpawner} is provided. The flag is not persisted, so
 * a restored extension defaults to untrusted (fail-safe) until re-installed.
 */
export interface InstallRequest extends InstallSource {
  /** Run in the trusted in-process runtime (default `false` => sandbox if available). */
  trusted?: boolean;
}

/** The wired extension system App drives. */
export interface ExtensionSystem {
  /** The underlying host (lifecycle + persistence). */
  readonly host: ExtensionHost;
  /** The shared permission broker (every privileged method registered). */
  readonly broker: PermissionBroker;
  /** The persisted per-extension grant store. */
  readonly grants: GrantStore;
  /** Hydrate host state from storage (call once at startup). */
  restore(): Promise<void>;
  /** Install (or replace) an extension (additive `trusted` selects the runtime). */
  install(source: InstallRequest): Promise<ExtState>;
  /** Replace an extension's granted permission set (and refresh the snapshot). */
  setGrants(id: string, permissions: readonly Permission[]): Promise<void>;
  /** Enable an extension (activation stays lazy). */
  enable(id: string): Promise<ExtState>;
  /** Disable + tear down an extension. */
  disable(id: string): Promise<ExtState>;
  /** Uninstall an extension (and clear its grants). */
  uninstall(id: string): Promise<void>;
  /** Hot-reload an extension. */
  reload(id: string, source?: InstallSource): Promise<ExtState>;
  /** Force-activate an extension now (resolves its grant snapshot first). */
  activate(id: string): Promise<ExtState>;
  /** Fire an activation event (resolves grant snapshots for all managed exts first). */
  fire(event: ActivationEvent): Promise<ExtState[]>;
  /** Unregister all brokered API methods (e.g. on teardown). */
  dispose(): void;
}

/** Build a wired {@link ExtensionSystem} from injected services. */
export function createExtensionSystem(deps: ExtensionSystemDeps): ExtensionSystem {
  const version = deps.version ?? EXT_API_VERSION;
  const events = deps.events ?? createEventsBus();
  const audit = deps.audit ?? createAuditLog();
  const grants = createGrantStore(deps.storage);

  const broker = createPermissionBroker({
    grants,
    confirm: deps.confirm,
    audit,
    ...(deps.recordEgress ? { recordEgress: deps.recordEgress } : {}),
  });

  // Per-extension transient state, keyed by id.
  const disposeByExt = new Map<string, DisposeRegistry>();
  const grantSnapshot = new Map<string, ReadonlySet<Permission>>();

  const createContext: ContextFactory = (input) => {
    disposeByExt.set(input.id, input.dispose);
    input.dispose.add((): void => {
      disposeByExt.delete(input.id);
    });
    const granted = grantSnapshot.get(input.id) ?? new Set<Permission>();
    return assembleExtContext({
      extId: input.id,
      granted,
      broker,
      services: deps.services,
      dispose: input.dispose,
      version,
      events,
    });
  };

  // Per-extension runtime selector (T8.12). Trusted extensions (bundled examples)
  // load in-process; untrusted/imported extensions load through the sandbox when
  // a `spawn` is provided. Without `spawn`, everything falls back to in-process
  // (the real-Worker browser spawner is the deferred path; see ext/sandbox).
  const trustedById = new Map<string, boolean>();
  const inProcess = createInProcessRuntime();
  const sandbox: ExtensionRuntime | undefined = deps.spawn
    ? createSandboxRuntime({
        broker,
        spawn: deps.spawn,
        ...(deps.watchdog ? { watchdog: deps.watchdog } : {}),
        ...(deps.onTerminated ? { onTerminated: deps.onTerminated } : {}),
      })
    : undefined;

  const runtime: ExtensionRuntime = {
    load(record: ExtLoadRecord): Promise<LoadedExtension> {
      const trusted = trustedById.get(record.id) ?? false;
      if (trusted || sandbox === undefined) return inProcess.load(record);
      return sandbox.load(record);
    },
  };

  const host = new ExtensionHost({
    storage: deps.storage,
    runtime,
    createContext,
    ...(deps.namespace !== undefined ? { namespace: deps.namespace } : {}),
    ...(deps.now ? { now: deps.now } : {}),
  });

  const offApi = registerExtApi(broker, {
    services: deps.services,
    storageFor: (id) => host.extStorage(id),
    disposeFor: (id) => disposeByExt.get(id),
  });

  const refresh = async (id: string): Promise<void> => {
    grantSnapshot.set(id, new Set<Permission>(await grants.list(id)));
  };

  return {
    host,
    broker,
    grants,
    restore: () => host.restore(),
    install(source): Promise<ExtState> {
      const manifest = source.manifest ?? source.module?.manifest;
      if (manifest !== undefined) trustedById.set(manifest.id, source.trusted ?? false);
      return host.install(source);
    },
    async setGrants(id, permissions): Promise<void> {
      await grants.set(id, permissions);
      grantSnapshot.set(id, new Set<Permission>(permissions));
    },
    enable: (id) => host.enable(id),
    disable: (id) => host.disable(id),
    async uninstall(id): Promise<void> {
      await host.uninstall(id);
      await grants.clear(id);
      grantSnapshot.delete(id);
      trustedById.delete(id);
    },
    reload: (id, source) => host.reload(id, source),
    async activate(id): Promise<ExtState> {
      await refresh(id);
      return host.activate(id);
    },
    async fire(event): Promise<ExtState[]> {
      await Promise.all(host.list().map((s) => refresh(s.id)));
      return host.fireActivationEvent(event);
    },
    dispose(): void {
      offApi();
    },
  };
}
