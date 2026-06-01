/**
 * Service → port adapters for the extension system (M7 assembly; task T7.3, spec
 * plan/06 §6.4).
 *
 * {@link createExtServices} adapts the real app-scoped services into the
 * {@link ExtApiServices} ports the extension API ({@link createExtensionSystem})
 * wraps. The adapters are thin pass-throughs — all permission gating lives in
 * the broker + {@link assembleExtContext}. Each adapter mirrors exactly the
 * slice a `ctx.*` group needs:
 *
 *  - `connection`  — connection state from the shared store + host state taps;
 *  - `vehicles`    — the telemetry snapshot in the store + host telemetry taps;
 *  - `mavlink`     — host `onMessage` taps, a `latest`/`rate` cache fed by the
 *                    on-demand inspector stream, and `requestInterval` via the
 *                    {@link StreamRateService};
 *  - `command`/`params`/`mission` — the app-scoped microservice clients;
 *  - `ui`          — the shell {@link UiRegistry} + a tiny DOM hyperscript;
 *  - `notify`      — shell toasts;
 *  - `files`       — the storage {@link FileIo}, adapted to the bare-Blob port;
 *  - `net`         — the platform `fetch` (per-host egress gated by the broker);
 *  - `map`/`theme`/`transports` — documented NO-OP STUB ports so the bundled
 *                    map-layer / transport / theme examples degrade gracefully
 *                    (no app-scoped MapEngine/transport registry exists to wire
 *                    cleanly at this seam — see {@link createExtServices}).
 *
 * `mavlink.loadDialect` is likewise a documented no-op: the worker owns the
 * dialect tables and exposes no runtime-injection seam, so an extension that
 * requests the `dialect` scope simply gets a no-op rather than a crash.
 */
import type {
  CommandClient,
  ConnState,
  DecodedMessage,
  FieldValue,
  FileIo,
  MapEngine,
  MissionClient,
  ParamClient,
  Store,
  AppState,
  TransportFactory,
  UiRegistry,
  VehicleState,
} from '../../../contracts';
import type {
  ExtApiServices,
  MavlinkSubscribeOptions,
  NetPort,
  ThemePort,
  TransportsPort,
  UiPort,
} from '../../../ext/api';
import { BUILTIN_DIALECTS } from '../../../mavlink/dialects';
import { createStreamRateService } from '../../../mavlink/microservices/streams';

/**
 * A structural inspector row the `latest`/`rate` cache reads (host projection).
 * Only `name`/`fields` are required so a bare host mock (narrow rows) stays
 * assignable to {@link ExtHost}; the real host fills the rest and drives a
 * complete {@link DecodedMessage}.
 */
interface InspectorRowLike {
  readonly name: string;
  readonly fields: Record<string, FieldValue>;
  readonly sysid?: number;
  readonly compid?: number;
  readonly seq?: number;
  readonly msgId?: number;
  readonly rateHz?: number;
  readonly raw?: Uint8Array;
  readonly crcOk?: boolean;
  readonly signed?: boolean;
  readonly linkId?: number;
  readonly rxTimeUs?: number;
}

/** A structural inspector snapshot the cache reads. */
interface InspectorSnapshotLike {
  readonly rows: readonly InspectorRowLike[];
}

/**
 * The structural slice of the MAVLink host the extension ports need. The real
 * {@link import('../../../mavlink/host').MavlinkHost} satisfies it; tests pass a
 * lightweight fake. `subscribeInspector` is optional — without it `latest`/
 * `rate` simply report nothing.
 */
export interface ExtHost {
  /** Encode + send a message out the active link. */
  sendMessage(name: string, fields: Record<string, unknown>): void | Promise<void>;
  /** Subscribe a selective decoded-message tap; returns an unsubscribe fn. */
  onMessage(names: readonly string[], cb: (msg: DecodedMessage) => void): () => void;
  /** Subscribe to connection-state transitions. */
  onState(cb: (state: ConnState) => void): () => void;
  /** Subscribe to coalesced telemetry snapshots (change trigger only). */
  onTelemetry(cb: (snapshot: unknown) => void): () => void;
  /** Subscribe the on-demand inspector stream (latest/rate cache source). */
  subscribeInspector?(
    cb: (snap: InspectorSnapshotLike) => void,
    opts?: { hz?: number },
  ): () => void;
}

/** Construction dependencies for {@link createExtServices}. */
export interface ExtServicesDeps {
  /** The MAVLink host (real worker host, or a fake in tests). */
  readonly host: ExtHost;
  /** The shared app store (connection + vehicles snapshot source). */
  readonly store: Store<AppState>;
  /** App-scoped command microservice. */
  readonly command: CommandClient;
  /** App-scoped parameter microservice. */
  readonly params: ParamClient;
  /** App-scoped mission microservice. */
  readonly mission: MissionClient;
  /** Shell UI registry (panels / commands / toasts / confirm). */
  readonly registry: UiRegistry;
  /** Storage file picker I/O (adapted to the bare-Blob `files` port). */
  readonly files: FileIo;
  /** Inspector cache cadence in Hz (default 4). */
  readonly inspectorHz?: number;
}

/** The built ports plus a disposer and the list of stubbed (no-op) ports. */
export interface ExtServicesHandle {
  /** The wired {@link ExtApiServices} bundle. */
  readonly services: ExtApiServices;
  /** Tear down the inspector cache subscription. */
  readonly dispose: () => void;
  /** Ports provided as documented no-op stubs (for the handoff/notes). */
  readonly stubbed: readonly string[];
}

/** Build a `messageName -> id` lookup across the built-in dialects. */
function buildNameToId(): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const dialect of BUILTIN_DIALECTS) {
    for (const meta of Object.values(dialect.messages)) {
      if (!map.has(meta.name)) map.set(meta.name, meta.id);
    }
  }
  return map;
}

/** Convert a host inspector row into a frozen {@link DecodedMessage}. */
function rowToDecoded(row: InspectorRowLike): DecodedMessage {
  return {
    sysid: row.sysid ?? 0,
    compid: row.compid ?? 0,
    seq: row.seq ?? 0,
    msgId: row.msgId ?? 0,
    name: row.name,
    fields: row.fields,
    crcOk: row.crcOk ?? true,
    signed: row.signed ?? false,
    rxTimeUs: row.rxTimeUs ?? 0,
    raw: row.raw ?? new Uint8Array(),
    ...(row.linkId !== undefined ? { linkId: row.linkId } : {}),
  };
}

/** Append one hyperscript child (string/number/Node) to `el`. */
function appendChild(el: HTMLElement, kid: unknown): void {
  if (kid === undefined || kid === null || kid === false || kid === true) return;
  if (Array.isArray(kid)) {
    for (const inner of kid) appendChild(el, inner);
    return;
  }
  el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
}

/** A tiny DOM hyperscript (`ctx.ui.h`) — builds an element, no framework. */
function hyperscript(tag: string, props: unknown, kids: readonly unknown[]): HTMLElement {
  const el = document.createElement(tag);
  if (props !== null && typeof props === 'object') {
    for (const [key, value] of Object.entries(props as Record<string, unknown>)) {
      if (value === undefined || value === null) continue;
      if (key === 'class' || key === 'className') {
        el.setAttribute('class', String(value));
      } else if (key === 'style' && typeof value === 'object') {
        Object.assign(el.style, value as Record<string, string>);
      } else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (typeof value !== 'function') {
        el.setAttribute(key, String(value));
      }
    }
  }
  for (const kid of kids) appendChild(el, kid);
  return el;
}

/** A no-op {@link MapEngine} stub (returns inert disposers; renders nothing). */
function createStubMap(): MapEngine {
  const noop = (): void => undefined;
  return {
    addLayer: () => noop,
    on: () => noop,
    setBasemap: noop,
    prefetch: () => Promise.resolve(),
  };
}

/** A no-op {@link ThemePort} stub (token registration is inert at this seam). */
function createStubTheme(): ThemePort {
  return { register: () => () => undefined };
}

/** A no-op {@link TransportsPort} stub (factory registration is inert here). */
function createStubTransports(): TransportsPort {
  return { register: (_f: TransportFactory) => () => undefined };
}

/**
 * Build the {@link ExtApiServices} ports from the real app-scoped services. The
 * returned {@link ExtServicesHandle.dispose} tears down the inspector-cache
 * subscription; call it when the host is disposed.
 */
export function createExtServices(deps: ExtServicesDeps): ExtServicesHandle {
  const { host, store, registry } = deps;

  // --- mavlink latest/rate cache (fed by the on-demand inspector stream) -----
  const latestByName = new Map<string, DecodedMessage>();
  const rateByName = new Map<string, number>();
  let offInspector: (() => void) | undefined;
  if (host.subscribeInspector !== undefined) {
    offInspector = host.subscribeInspector(
      (snap) => {
        latestByName.clear();
        rateByName.clear();
        for (const row of snap.rows) {
          latestByName.set(row.name, rowToDecoded(row));
          rateByName.set(row.name, Math.max(rateByName.get(row.name) ?? 0, row.rateHz ?? 0));
        }
      },
      { hz: deps.inspectorHz ?? 4 },
    );
  }

  // --- mavlink requestInterval (SET_MESSAGE_INTERVAL via the stream service) --
  const nameToId = buildNameToId();
  const streamRate = createStreamRateService({
    send: (name, fields) => host.sendMessage(name, fields),
  });

  const subscribe = (
    name: string,
    cb: (m: DecodedMessage) => void,
    opts?: MavlinkSubscribeOptions,
  ): (() => void) => {
    const minIntervalMs = opts?.rateHz !== undefined && opts.rateHz > 0 ? 1000 / opts.rateHz : 0;
    let lastEmit = 0;
    return host.onMessage([name], (msg) => {
      if (opts?.sysid !== undefined && msg.sysid !== opts.sysid) return;
      if (opts?.compid !== undefined && msg.compid !== opts.compid) return;
      if (minIntervalMs > 0) {
        const now = Date.now();
        if (now - lastEmit < minIntervalMs) return;
        lastEmit = now;
      }
      cb(msg);
    });
  };

  const activeVehicle = (): VehicleState => {
    const s = store.get();
    const v = s.activeSysid === undefined ? undefined : s.vehicles[s.activeSysid];
    if (v === undefined) throw new Error('no active vehicle');
    return v;
  };

  const ui: UiPort = {
    registerPanel: (def) => registry.registerPanel(def),
    registerCommand: (def) => registry.registerCommand(def),
    addMenuItem: (location, item) => registry.addMenuItem(location, item),
    toast: (kind, msg) => registry.toast(kind, msg),
    confirm: (opts) => registry.confirm(opts),
    registerWidget: () => () => undefined,
    h: (tag, props, ...kids) => hyperscript(tag, props, kids),
  };

  const net: NetPort = {
    fetch: (url, init) => fetch(url, init),
  };

  const services: ExtApiServices = {
    connection: {
      state: () => store.get().connection,
      on: (cb) => host.onState((s) => cb(s)),
    },
    vehicles: {
      list: () => Object.values(store.get().vehicles),
      active: activeVehicle,
      on: (cb) => host.onTelemetry(() => cb()),
    },
    mavlink: {
      on: subscribe,
      latest: (name) => latestByName.get(name),
      rate: (name) => rateByName.get(name) ?? 0,
      requestInterval: (name, hz) => {
        const id = nameToId.get(name);
        if (id !== undefined) void streamRate.setMessageRate(id, hz);
      },
      send: (name, fields) => {
        void host.sendMessage(name, fields);
      },
      // Documented no-op: the worker owns dialect tables, no runtime seam here.
      loadDialect: () => undefined,
    },
    command: deps.command,
    params: deps.params,
    mission: deps.mission,
    ui,
    notify: {
      info: (msg) => registry.toast('info', msg),
      warn: (msg) => registry.toast('warn', msg),
      error: (msg) => registry.toast('error', msg),
    },
    map: createStubMap(),
    theme: createStubTheme(),
    transports: createStubTransports(),
    net,
    files: {
      openForRead: async (): Promise<Blob> => {
        const picked = await deps.files.openForRead();
        return picked === undefined ? new Blob([]) : picked.blob;
      },
      saveAs: (blob, name) => deps.files.saveAs(blob, name),
    },
  };

  return {
    services,
    dispose: () => {
      offInspector?.();
      latestByName.clear();
      rateByName.clear();
    },
    stubbed: ['map', 'theme', 'transports', 'mavlink.loadDialect'],
  };
}
