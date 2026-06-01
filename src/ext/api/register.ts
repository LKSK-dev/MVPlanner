/**
 * Broker API registration (task T7.3; spec plan/06 §6.4/§6.5).
 *
 * {@link registerExtApi} registers a handler for **every** privileged `ctx`
 * method in the {@link CAPABILITY_MAP} on the {@link PermissionBroker}, wrapping
 * the injected real services ({@link ExtApiServices}). The broker enforces the
 * permission, the armed-aware confirm + audit (vehicle-affecting scopes) and the
 * per-call `net:<host>` egress gate; this module only does the thin
 * args→service wiring. It is the privileged surface the sandbox guest reaches
 * over RPC ({@link import('../sandbox').createSandboxRuntime}); the trusted
 * in-process surface ({@link import('./context').assembleExtContext}) routes its
 * vehicle-affecting calls through the same broker so both paths share one policy.
 *
 * Registration-style methods (`registerPanel`/`addLayer`/`on`/…) hand the host a
 * disposer that cannot cross the RPC boundary, so it is tracked in the
 * extension's {@link DisposeRegistry} (resolved via {@link RegisterExtApiDeps.disposeFor})
 * and torn down on deactivate/reload; the call resolves with `undefined`.
 */
import type {
  CommandClient,
  ConnState,
  DecodedMessage,
  MissionClient,
  Param,
  TransportFactory,
} from '../../contracts';
import type { ApiHandler, PermissionBroker } from '../permissions';
import type { DisposeRegistry, ExtKvStore } from '../host';
import { CAPABILITY_MAP } from './capability-map';
import type { ExtApiServices, MavlinkSubscribeOptions } from './ports';

/** Injected dependencies for {@link registerExtApi}. */
export interface RegisterExtApiDeps {
  /** The real services each `ctx.*` group wraps. */
  services: ExtApiServices;
  /** Per-extension scoped KV store (the host's `extStorage(id)`). */
  storageFor(extId: string): ExtKvStore;
  /**
   * The active {@link DisposeRegistry} for `extId` (host-supplied at activation),
   * used to track registration/subscription disposers. `undefined` ⇒ disposers
   * are dropped (still functional, but not torn down by the host).
   */
  disposeFor(extId: string): DisposeRegistry | undefined;
}

/** Resolve a 0-based positional arg with an expected type (broker args are `unknown[]`). */
function arg<T>(args: readonly unknown[], i: number): T {
  return args[i] as T;
}

/**
 * Build the handler table. Each handler receives `(extId, args, signal?)`;
 * disposer-returning methods register the disposer on the extension's
 * {@link DisposeRegistry} and resolve `undefined`.
 */
function buildHandlers(deps: RegisterExtApiDeps): Record<string, ApiHandler> {
  const { services } = deps;

  /** Track a disposer in the extension's dispose registry (LIFO teardown). */
  const track = (extId: string, disposer: () => void): void => {
    deps.disposeFor(extId)?.add(disposer);
  };

  /** Wrap a service `(...) => () => void` registration into a tracked, void handler. */
  const tracked =
    (register: (extId: string, args: readonly unknown[]) => () => void): ApiHandler =>
    (extId, args): Promise<unknown> => {
      track(extId, register(extId, args));
      return Promise.resolve(undefined);
    };

  /** Wrap a synchronous read into a resolved handler. */
  const read =
    (get: (args: readonly unknown[]) => unknown): ApiHandler =>
    (_extId, args): Promise<unknown> =>
      Promise.resolve(get(args));

  /** Forward to a {@link CommandClient} method (vehicle-affecting; broker audits). */
  const cmd =
    <K extends keyof CommandClient>(name: K): ApiHandler =>
    (_extId, args): Promise<unknown> => {
      const fn = services.command[name] as (...a: unknown[]) => Promise<unknown>;
      return fn.apply(services.command, args as unknown[]);
    };

  /** Forward to a {@link MissionClient} method. */
  const mission =
    <K extends keyof MissionClient>(name: K): ApiHandler =>
    (_extId, args): Promise<unknown> => {
      const fn = services.mission[name] as (...a: unknown[]) => Promise<unknown>;
      return fn.apply(services.mission, args as unknown[]);
    };

  const handlers: Record<string, ApiHandler> = {
    // Connection.
    'connection.state': read(() => services.connection.state()),
    'connection.on': tracked((_id, args) =>
      services.connection.on(arg<(s: ConnState) => void>(args, 0)),
    ),

    // Vehicles.
    'vehicles.list': read(() => services.vehicles.list()),
    'vehicles.active': read(() => services.vehicles.active()),
    'vehicles.on': tracked((_id, args) => services.vehicles.on(arg<() => void>(args, 0))),

    // MAVLink reads.
    'mavlink.on': tracked((_id, args) =>
      services.mavlink.on(
        arg<string>(args, 0),
        arg<(m: DecodedMessage) => void>(args, 1),
        arg<MavlinkSubscribeOptions | undefined>(args, 2),
      ),
    ),
    'mavlink.latest': read((args) => services.mavlink.latest(arg<string>(args, 0))),
    'mavlink.rate': read((args) => services.mavlink.rate(arg<string>(args, 0))),
    'mavlink.requestInterval': (_id, args): Promise<unknown> => {
      services.mavlink.requestInterval(arg<string>(args, 0), arg<number>(args, 1));
      return Promise.resolve(undefined);
    },
    // MAVLink writes / advanced.
    'mavlink.send': (_id, args): Promise<unknown> => {
      services.mavlink.send(
        arg<string>(args, 0),
        arg<Record<string, unknown>>(args, 1),
        arg<{ signed?: boolean } | undefined>(args, 2),
      );
      return Promise.resolve(undefined);
    },
    'mavlink.loadDialect': (_id, args): Promise<unknown> => {
      services.mavlink.loadDialect(arg<string>(args, 0));
      return Promise.resolve(undefined);
    },

    // Command.
    'command.send': cmd('send'),
    'command.arm': cmd('arm'),
    'command.setMode': cmd('setMode'),
    'command.takeoff': cmd('takeoff'),
    'command.land': cmd('land'),
    'command.rtl': cmd('rtl'),
    'command.guidedGoto': cmd('guidedGoto'),
    'command.setRoi': cmd('setRoi'),
    'command.clearRoi': cmd('clearRoi'),
    'command.setCurrentWp': cmd('setCurrentWp'),

    // Parameters.
    'params.get': read((args) => services.params.get(arg<string>(args, 0))),
    'params.fetchAll': (): Promise<unknown> => services.params.fetchAll(),
    'params.onChange': tracked((_id, args) =>
      services.params.onChange(arg<(p: Param) => void>(args, 0)),
    ),
    'params.set': (_id, args): Promise<unknown> =>
      services.params.set(arg<string>(args, 0), arg<number>(args, 1)),

    // Mission.
    'mission.download': mission('download'),
    'mission.onCurrent': tracked((_id, args) =>
      services.mission.onCurrent(arg<(seq: number) => void>(args, 0)),
    ),
    'mission.onReached': tracked((_id, args) =>
      services.mission.onReached(arg<(seq: number) => void>(args, 0)),
    ),
    'mission.upload': mission('upload'),
    'mission.clear': mission('clear'),
    'mission.setCurrent': mission('setCurrent'),

    // UI.
    'ui.registerPanel': tracked((_id, args) =>
      services.ui.registerPanel(arg<Parameters<ExtApiServices['ui']['registerPanel']>[0]>(args, 0)),
    ),
    'ui.registerWidget': tracked((_id, args) => services.ui.registerWidget(...(args as unknown[]))),
    'ui.registerCommand': tracked((_id, args) =>
      services.ui.registerCommand(
        arg<Parameters<ExtApiServices['ui']['registerCommand']>[0]>(args, 0),
      ),
    ),
    'ui.addMenuItem': tracked((_id, args) =>
      services.ui.addMenuItem(
        arg<string>(args, 0),
        arg<Parameters<ExtApiServices['ui']['addMenuItem']>[1]>(args, 1),
      ),
    ),
    'ui.confirm': (_id, args): Promise<unknown> =>
      services.ui.confirm(arg<Parameters<ExtApiServices['ui']['confirm']>[0]>(args, 0)),
    'ui.toast': (_id, args): Promise<unknown> => {
      services.ui.toast(arg<'info' | 'warn' | 'error'>(args, 0), arg<string>(args, 1));
      return Promise.resolve(undefined);
    },

    // Notifications.
    'notify.info': (_id, args): Promise<unknown> => {
      services.notify.info(arg<string>(args, 0));
      return Promise.resolve(undefined);
    },
    'notify.warn': (_id, args): Promise<unknown> => {
      services.notify.warn(arg<string>(args, 0));
      return Promise.resolve(undefined);
    },
    'notify.error': (_id, args): Promise<unknown> => {
      services.notify.error(arg<string>(args, 0));
      return Promise.resolve(undefined);
    },

    // Storage (per-extension namespaced KV).
    'storage.get': (extId, args): Promise<unknown> =>
      deps.storageFor(extId).get(arg<string>(args, 0)),
    'storage.set': (extId, args): Promise<unknown> =>
      deps.storageFor(extId).set(arg<string>(args, 0), arg<unknown>(args, 1)),
  };

  // Map (optional service).
  if (services.map) {
    const map = services.map;
    handlers['map.addLayer'] = tracked((_id, args) =>
      map.addLayer(arg<Parameters<typeof map.addLayer>[0]>(args, 0)),
    );
    handlers['map.on'] = tracked((_id, args) =>
      map.on(
        arg<'click' | 'move'>(args, 0),
        arg<(e: { lat: number; lon: number }) => void>(args, 1),
      ),
    );
    handlers['map.setBasemap'] = (_id, args): Promise<unknown> => {
      map.setBasemap(arg<Parameters<typeof map.setBasemap>[0]>(args, 0));
      return Promise.resolve(undefined);
    };
    handlers['map.prefetch'] = (_id, args): Promise<unknown> =>
      map.prefetch(
        arg<Parameters<typeof map.prefetch>[0]>(args, 0),
        arg<[number, number]>(args, 1),
      );
  }

  // Theme (optional service).
  if (services.theme) {
    const theme = services.theme;
    handlers['theme.register'] = tracked((_id, args) => theme.register(arg<unknown>(args, 0)));
  }

  // Logs (optional service).
  if (services.logs) {
    const logs = services.logs;
    handlers['logs.openCurrentTlog'] = read(() => logs.openCurrentTlog());
    handlers['logs.queryDataFlash'] = (_id, args): Promise<unknown> =>
      logs.queryDataFlash(arg<string>(args, 0), arg<[number, number]>(args, 1));
  }

  // Files (optional service).
  if (services.files) {
    const files = services.files;
    handlers['files.openForRead'] = (): Promise<unknown> => files.openForRead();
    handlers['files.saveAs'] = (_id, args): Promise<unknown> =>
      files.saveAs(arg<Blob>(args, 0), arg<string>(args, 1));
  }

  // Networking (optional service; per-call host gating done by the broker).
  if (services.net) {
    const net = services.net;
    handlers['net.fetch'] = (_id, args): Promise<unknown> =>
      net.fetch(arg<string>(args, 0), arg<RequestInit | undefined>(args, 1));
  }

  // Transports (optional service).
  if (services.transports) {
    const transports = services.transports;
    handlers['transports.register'] = tracked((_id, args) =>
      transports.register(arg<TransportFactory>(args, 0)),
    );
  }

  return handlers;
}

/**
 * Register every privileged `ctx` method on `broker` against the injected
 * services. Methods whose optional backing service is absent are skipped (so
 * they are absent from the guest proxy + assembled `ctx`). Returns a disposer
 * that unregisters all of them.
 */
export function registerExtApi(broker: PermissionBroker, deps: RegisterExtApiDeps): () => void {
  const handlers = buildHandlers(deps);
  const offs: (() => void)[] = [];

  for (const spec of CAPABILITY_MAP) {
    const handler = handlers[spec.method];
    if (!handler) continue; // optional service absent — skip this method
    offs.push(
      broker.registerApi(spec.method, spec.permission, handler, spec.net ? { net: true } : {}),
    );
  }

  return (): void => {
    for (const off of offs) off();
  };
}
