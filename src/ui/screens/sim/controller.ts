/**
 * Extensions-manager controller (M7 assembly; spec plan/06 §6.3/§6.5).
 *
 * The testable, DOM-free orchestration layer between the
 * {@link ExtensionsManager} UI and the wired {@link ExtensionSystem}: it owns the
 * reactive list of installed extensions + their granted permissions, and the
 * install / enable / disable / uninstall / reload / revoke flows (each routing
 * grant prompts through the injected {@link GrantPrompt}). It also loads the
 * bundled first-party example modules at init so they appear in the manager.
 *
 * Enabling an extension prompts for its declared permissions on first enable
 * (none granted yet), then force-activates it; a throwing `activate` is isolated
 * by the host and surfaces as the `'error'` (paused) status.
 */
import { createSignal, type Accessor } from 'solid-js';
import type { ExtManifest, FileIo, Permission } from '../../../contracts';
import type { ExtensionSystem } from '../../../ext/api';
import type { ExtModule, ExtState } from '../../../ext/host';
import { type GrantPrompt, requestGrants } from '../../../ext/permissions';

/** i18n translate fn (for human-readable error toasts). */
export type TFn = (k: string, vars?: Record<string, string | number>) => string;

/** A bundled example module (carries its manifest, per `extensions/index.js`). */
export type ExampleModule = ExtModule;

/** Notification sink (the shell toast surface). */
export interface NotifySink {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/** Construction dependencies for {@link createExtensionsController}. */
export interface ExtensionsControllerDeps {
  /** The wired extension system. */
  readonly system: ExtensionSystem;
  /** Install-time permission prompt. */
  readonly prompt: GrantPrompt;
  /** File picker for `.mvpext` / JSON-bundle import. */
  readonly files: FileIo;
  /** Toast sink for install errors. */
  readonly notify: NotifySink;
  /** i18n translate fn. */
  readonly t: TFn;
  /** Bundled example modules to install at init (so they appear in the list). */
  readonly examples?: readonly ExampleModule[];
}

/** The reactive surface + actions the manager UI binds to. */
export interface ExtensionsController {
  /** Reactive list of installed extensions. */
  readonly states: Accessor<readonly ExtState[]>;
  /** Reactive `id -> granted permissions` snapshot. */
  readonly grants: Accessor<ReadonlyMap<string, readonly Permission[]>>;
  /** Restore persisted state, install the bundled examples, then refresh. */
  init(): Promise<void>;
  /** Re-read the host's state + grants into the reactive signals. */
  refresh(): Promise<void>;
  /** Enable + force-activate an extension (prompting for grants on first enable). */
  enable(id: string): Promise<void>;
  /** Disable + tear down an extension. */
  disable(id: string): Promise<void>;
  /** Uninstall an extension and clear its grants. */
  uninstall(id: string): Promise<void>;
  /** Hot-reload an extension (re-supplying its bundled module when known). */
  reload(id: string): Promise<void>;
  /** Revoke one granted permission (reloading the extension if active). */
  revoke(id: string, permission: Permission): Promise<void>;
  /** Import an extension from a file (JSON bundle: `{ manifest, code? }`). */
  installFromFile(): Promise<void>;
}

/** Parse an imported bundle text into a manifest (+ optional code). */
function parseBundle(text: string): { manifest: unknown; code?: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('not-json');
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error('not-object');
  const obj = parsed as Record<string, unknown>;
  if (obj['manifest'] !== undefined && typeof obj['manifest'] === 'object') {
    return {
      manifest: obj['manifest'],
      ...(typeof obj['code'] === 'string' ? { code: obj['code'] } : {}),
    };
  }
  if (typeof obj['id'] === 'string' && Array.isArray(obj['permissions'])) {
    return { manifest: obj };
  }
  throw new Error('unsupported');
}

/** Build the extensions-manager controller from injected deps. */
export function createExtensionsController(deps: ExtensionsControllerDeps): ExtensionsController {
  const { system } = deps;
  const [states, setStates] = createSignal<readonly ExtState[]>([]);
  const [grants, setGrants] = createSignal<ReadonlyMap<string, readonly Permission[]>>(
    new Map<string, readonly Permission[]>(),
  );

  // Examples keyed by id so reload/revoke can re-supply their in-process module.
  const moduleById = new Map<string, ExtModule>();
  for (const mod of deps.examples ?? []) moduleById.set(mod.manifest.id, mod);

  const refresh = async (): Promise<void> => {
    const list = system.host.list();
    setStates(list);
    const entries = await Promise.all(
      list.map(
        async (s): Promise<[string, readonly Permission[]]> => [
          s.id,
          await system.grants.list(s.id),
        ],
      ),
    );
    setGrants(new Map<string, readonly Permission[]>(entries));
  };

  const reloadModule = (id: string): { module: ExtModule } | undefined => {
    const mod = moduleById.get(id);
    return mod === undefined ? undefined : { module: mod };
  };

  const init = async (): Promise<void> => {
    await system.restore();
    for (const mod of deps.examples ?? []) {
      const existing = system.host.get(mod.manifest.id);
      await system.install({
        module: mod,
        manifest: mod.manifest,
        enabled: existing?.enabled ?? false,
        // Bundled first-party examples are trusted: in-process runtime (T8.12).
        trusted: true,
      });
    }
    // Lazily activate any enabled (previously-granted) example.
    await system.fire('onStartup');
    await refresh();
  };

  /** Surface an action failure via the notify seam (mirrors installFromFile). */
  const guardAction = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.notify.error(deps.t('extmgr.actionError', { message }));
      await refresh().catch(() => undefined);
    }
  };

  const enableImpl = async (id: string): Promise<void> => {
    await system.enable(id);
    const state = system.host.get(id);
    const existing = await system.grants.list(id);
    if (state !== undefined && existing.length === 0 && state.manifest.permissions.length > 0) {
      await requestGrants(state.manifest, { prompt: deps.prompt, grants: system.grants });
    }
    await system.activate(id);
    await refresh();
  };

  const enable = (id: string): Promise<void> => guardAction(() => enableImpl(id));

  const disable = (id: string): Promise<void> =>
    guardAction(async () => {
      await system.disable(id);
      await refresh();
    });

  const uninstall = (id: string): Promise<void> =>
    guardAction(async () => {
      await system.uninstall(id);
      await refresh();
    });

  const reload = (id: string): Promise<void> =>
    guardAction(async () => {
      await system.reload(id, reloadModule(id));
      await refresh();
    });

  const revokeImpl = async (id: string, permission: Permission): Promise<void> => {
    const current = await system.grants.list(id);
    await system.setGrants(
      id,
      current.filter((p) => p !== permission),
    );
    if (system.host.get(id)?.status === 'active') {
      await system.reload(id, reloadModule(id));
    }
    await refresh();
  };

  const revoke = (id: string, permission: Permission): Promise<void> =>
    guardAction(() => revokeImpl(id, permission));

  const installFromFile = async (): Promise<void> => {
    const picked = await deps.files.openForRead(['.json', '.mvpext', '.mvpext.js']);
    if (picked === undefined) return;
    try {
      const bundle = parseBundle(await picked.blob.text());
      await system.install({
        manifest: bundle.manifest as ExtManifest,
        ...(bundle.code !== undefined ? { code: bundle.code } : {}),
        enabled: false,
        // Imported extensions are untrusted: sandbox runtime when available (T8.12).
        trusted: false,
      });
      await refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'unsupported' || message === 'not-json' || message === 'not-object') {
        deps.notify.error(deps.t('extmgr.importUnsupported'));
      } else {
        deps.notify.error(deps.t('extmgr.installError', { message }));
      }
    }
  };

  return {
    states,
    grants,
    init,
    refresh,
    enable,
    disable,
    uninstall,
    reload,
    revoke,
    installFromFile,
  };
}
