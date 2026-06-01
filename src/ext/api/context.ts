/**
 * Trusted-path {@link ExtContext} assembly (task T7.3; spec plan/06 §6.4/§6.5).
 *
 * {@link assembleExtContext} builds the FROZEN {@link ExtContext} for the
 * in-process / trusted runtime, gated by a *resolved* grant set so the
 * synchronous reads in the contract (`connection.state`, `mavlink.latest`,
 * `vehicles.list`, …) keep their sync signatures. The two-tier gating mirrors
 * the contract shape:
 *
 *  - **Optional groups** (`command`/`params`/`mission`/`ui`/`map`/`theme`/`logs`/
 *    `files`/`net`/`transports`) are **absent** unless their permission is
 *    granted (and their backing service present) — spec plan/06 §6.5 "no
 *    permission ⇒ the method is absent".
 *  - **Always-present groups** (`connection`/`vehicles`/`mavlink`/`storage`/
 *    `notify`/`log`/`timers`/`events`) match the non-optional contract fields;
 *    their privileged members throw {@link ExtPermissionError} when ungranted.
 *
 * Every Promise-returning privileged method routes through the
 * {@link PermissionBroker} (so vehicle-affecting calls share the same
 * armed-aware confirm + audit, and `net.fetch` the same egress gate, as the
 * sandbox path); synchronous reads/registrations call the service directly after
 * a synchronous grant check. Registration/subscription disposers are tracked in
 * the per-extension {@link DisposeRegistry} and returned to the caller.
 */
import type {
  CommandClient,
  ExtContext,
  MissionClient,
  Mission,
  Param,
  Permission,
} from '../../contracts';
import type { DisposeRegistry } from '../host';
import { ExtPermissionError, type PermissionBroker } from '../permissions';
import { type EventsBus, type ExtLogSink, createEventsBus, makeLogSink } from './locals';
import type { ExtApiServices } from './ports';

/** Inputs to {@link assembleExtContext} (one extension activation). */
export interface AssembleExtContextDeps {
  /** The extension id (audit origin + per-extension scoping). */
  extId: string;
  /** The resolved permission grant snapshot for this activation. */
  granted: ReadonlySet<Permission>;
  /** The shared broker (already wired by {@link import('./register').registerExtApi}). */
  broker: PermissionBroker;
  /** The real services the synchronous reads/registrations call directly. */
  services: ExtApiServices;
  /** The per-extension dispose registry (tracks subscriptions/timers). */
  dispose: DisposeRegistry;
  /** Public extension API version surfaced as `ctx.version`. */
  version: string;
  /** Shared inter-extension event bus; one is created if omitted. */
  events?: EventsBus;
  /** `ctx.log` sink; defaults to a console logger tagged with `extId`. */
  log?: ExtLogSink;
}

/** Build the frozen {@link ExtContext} for a trusted in-process activation. */
export function assembleExtContext(deps: AssembleExtContextDeps): ExtContext {
  const { extId, granted, broker, services, dispose, version } = deps;
  const events = deps.events ?? createEventsBus();
  const log = deps.log ?? makeLogSink(extId);

  /** Throw if `p` is not granted (synchronous gate for sync members). */
  const gate = (p: Permission): void => {
    if (!granted.has(p)) {
      throw new ExtPermissionError('not-granted', `extension "${extId}" lacks permission "${p}"`);
    }
  };

  /** Route a Promise-returning privileged call through the broker. */
  const call = (method: string, args: readonly unknown[]): Promise<unknown> =>
    broker.invoke(extId, method, args);

  /** Track a service disposer in the dispose registry; return a one-shot handle. */
  const keep = (disposer: () => void): (() => void) => dispose.add(disposer);

  const hasNet = [...granted].some((p) => p.startsWith('net:'));

  const command: ExtContext['command'] = granted.has('command')
    ? {
        send: (cmd, params, opts): ReturnType<CommandClient['send']> =>
          call('command.send', [cmd, params, opts]) as ReturnType<CommandClient['send']>,
        arm: (arm, force): Promise<void> => call('command.arm', [arm, force]) as Promise<void>,
        setMode: (mode): Promise<void> => call('command.setMode', [mode]) as Promise<void>,
        takeoff: (altM): Promise<void> => call('command.takeoff', [altM]) as Promise<void>,
        land: (): Promise<void> => call('command.land', []) as Promise<void>,
        rtl: (): Promise<void> => call('command.rtl', []) as Promise<void>,
        guidedGoto: (lat, lon, altM): Promise<void> =>
          call('command.guidedGoto', [lat, lon, altM]) as Promise<void>,
        setRoi: (lat, lon, altM): Promise<void> =>
          call('command.setRoi', [lat, lon, altM]) as Promise<void>,
        clearRoi: (): Promise<void> => call('command.clearRoi', []) as Promise<void>,
        setCurrentWp: (seq): Promise<void> => call('command.setCurrentWp', [seq]) as Promise<void>,
      }
    : undefined;

  const paramsPresent = granted.has('telemetry:read') || granted.has('params:write');
  const params: ExtContext['params'] = paramsPresent
    ? {
        fetchAll: (onProgress, signal): Promise<Param[]> =>
          call('params.fetchAll', [onProgress, signal]) as Promise<Param[]>,
        get: (name): Param | undefined => {
          gate('telemetry:read');
          return services.params.get(name);
        },
        set: (name, value): Promise<void> => call('params.set', [name, value]) as Promise<void>,
        onChange: (cb): (() => void) => {
          gate('telemetry:read');
          return keep(services.params.onChange(cb));
        },
      }
    : undefined;

  const missionPresent = granted.has('telemetry:read') || granted.has('mission:write');
  const mission: ExtContext['mission'] = missionPresent
    ? ({
        download: (type, onProgress, signal): Promise<Mission> =>
          call('mission.download', [type, onProgress, signal]) as Promise<Mission>,
        upload: (m, opts): Promise<void> => call('mission.upload', [m, opts]) as Promise<void>,
        clear: (type): Promise<void> => call('mission.clear', [type]) as Promise<void>,
        setCurrent: (seq): Promise<void> => call('mission.setCurrent', [seq]) as Promise<void>,
        onCurrent: (cb): (() => void) => {
          gate('telemetry:read');
          return keep(services.mission.onCurrent(cb));
        },
        onReached: (cb): (() => void) => {
          gate('telemetry:read');
          return keep(services.mission.onReached(cb));
        },
      } satisfies MissionClient)
    : undefined;

  const ui: ExtContext['ui'] = granted.has('ui:panel')
    ? {
        registerPanel: (def): (() => void) => keep(services.ui.registerPanel(def)),
        registerCommand: (def): (() => void) => keep(services.ui.registerCommand(def)),
        addMenuItem: (loc, item): (() => void) => keep(services.ui.addMenuItem(loc, item)),
        registerWidget: (...a: unknown[]): (() => void) => keep(services.ui.registerWidget(...a)),
        toast: (kind, msg): void => {
          gate('notify');
          services.ui.toast(kind, msg);
        },
        confirm: (opts): Promise<boolean> => call('ui.confirm', [opts]) as Promise<boolean>,
        h: (tag, props, ...kids): unknown => services.ui.h(tag, props, ...kids),
      }
    : undefined;

  const mapSvc = services.map;
  const map: ExtContext['map'] =
    granted.has('map') && mapSvc
      ? {
          addLayer: (layer): (() => void) => keep(mapSvc.addLayer(layer)),
          on: (ev, cb): (() => void) => keep(mapSvc.on(ev, cb)),
          setBasemap: (source): void => mapSvc.setBasemap(source),
          prefetch: (bbox, zoomRange): Promise<void> =>
            call('map.prefetch', [bbox, zoomRange]) as Promise<void>,
        }
      : undefined;

  const themeSvc = services.theme;
  const theme: ExtContext['theme'] =
    granted.has('ui:panel') && themeSvc
      ? { register: (tokens): (() => void) => keep(themeSvc.register(tokens)) }
      : undefined;

  const logsSvc = services.logs;
  const logs: ExtContext['logs'] =
    granted.has('telemetry:read') && logsSvc
      ? {
          openCurrentTlog: (): unknown => logsSvc.openCurrentTlog(),
          queryDataFlash: (expr, range): Promise<unknown> =>
            call('logs.queryDataFlash', [expr, range]),
        }
      : undefined;

  const filesSvc = services.files;
  const files: ExtContext['files'] =
    granted.has('files') && filesSvc
      ? {
          openForRead: (): Promise<Blob> => call('files.openForRead', []) as Promise<Blob>,
          saveAs: (b, name): Promise<void> => call('files.saveAs', [b, name]) as Promise<void>,
        }
      : undefined;

  const netSvc = services.net;
  const net: ExtContext['net'] =
    hasNet && netSvc
      ? {
          fetch: (url, init): Promise<Response> =>
            call('net.fetch', [url, init]) as Promise<Response>,
        }
      : undefined;

  const transportsSvc = services.transports;
  const transports: ExtContext['transports'] =
    granted.has('transport') && transportsSvc
      ? { register: (f): (() => void) => keep(transportsSvc.register(f)) }
      : undefined;

  const ctx: ExtContext = {
    version,
    connection: {
      state: () => services.connection.state(),
      on: (_ev, cb): (() => void) => keep(services.connection.on(cb)),
    },
    vehicles: {
      list: () => {
        gate('telemetry:read');
        return services.vehicles.list();
      },
      active: () => {
        gate('telemetry:read');
        return services.vehicles.active();
      },
      on: (_ev, cb): (() => void) => {
        gate('telemetry:read');
        return keep(services.vehicles.on(cb));
      },
    },
    mavlink: {
      on: (name, cb, o): (() => void) => {
        gate('telemetry:read');
        return keep(services.mavlink.on(name, cb, o));
      },
      latest: (name) => {
        gate('telemetry:read');
        return services.mavlink.latest(name);
      },
      rate: (name) => {
        gate('telemetry:read');
        return services.mavlink.rate(name);
      },
      requestInterval: (name, hz): void => {
        gate('telemetry:read');
        services.mavlink.requestInterval(name, hz);
      },
      ...(granted.has('mavlink:send')
        ? {
            send: (name, fields, o): void => {
              void call('mavlink.send', [name, fields, o]);
            },
          }
        : {}),
      ...(granted.has('dialect')
        ? {
            loadDialect: (xmlOrJson): void => {
              void call('mavlink.loadDialect', [xmlOrJson]);
            },
          }
        : {}),
    },
    ...(command !== undefined ? { command } : {}),
    ...(params !== undefined ? { params } : {}),
    ...(mission !== undefined ? { mission } : {}),
    ...(ui !== undefined ? { ui } : {}),
    ...(map !== undefined ? { map } : {}),
    ...(theme !== undefined ? { theme } : {}),
    ...(logs !== undefined ? { logs } : {}),
    storage: {
      get: <T>(k: string): Promise<T | undefined> =>
        call('storage.get', [k]) as Promise<T | undefined>,
      set: <T>(k: string, v: T): Promise<void> => call('storage.set', [k, v]) as Promise<void>,
    },
    ...(files !== undefined ? { files } : {}),
    ...(net !== undefined ? { net } : {}),
    ...(transports !== undefined ? { transports } : {}),
    notify: {
      info: (m): void => {
        gate('notify');
        services.notify.info(m);
      },
      warn: (m): void => {
        gate('notify');
        services.notify.warn(m);
      },
      error: (m): void => {
        gate('notify');
        services.notify.error(m);
      },
    },
    log,
    timers: {
      setInterval: (fn, ms): (() => void) => dispose.setInterval(fn, ms),
      raf: (fn): (() => void) => dispose.raf(fn),
    },
    events: {
      on: (t, cb): (() => void) => keep(events.on(t, cb)),
      emit: (t, p): void => events.emit(t, p),
    },
    onDispose: (fn): void => {
      dispose.add(fn);
    },
  };

  return ctx;
}
