/**
 * Extension API conformance suite (T7.7; spec plan/06 §6.10).
 *
 * The suite is intentionally driven by {@link CAPABILITY_MAP}: every mapped
 * public method gets an exposure/call-through check, a denied-permission check,
 * and participates in the coverage guard that fails when the frozen
 * {@link ExtContext} privileged surface drifts without a permission mapping.
 */
import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import type {
  Bbox,
  CommandClient,
  DecodedMessage,
  ExtContext,
  KvStore,
  MapLayer,
  Mission,
  MissionClient,
  Param,
  ParamClient,
  Permission,
  Transport,
  TransportFactory,
  VehicleState,
} from '../../src/contracts';
import { createAuditLog } from '../../src/core/audit';
import { DisposeRegistry, type ExtKvStore } from '../../src/ext/host';
import {
  ExtPermissionError,
  VEHICLE_AFFECTING_PERMISSIONS,
  createGrantStore,
  createPermissionBroker,
  type ConfirmFn,
  type EgressRecord,
  type GrantStore,
} from '../../src/ext/permissions';
import {
  CAPABILITY_MAP,
  assembleExtContext,
  buildExtApiDts,
  registerExtApi,
  type ConnectionPort,
  type ExtApiServices,
  type FilesPort,
  type LogsPort,
  type MavlinkPort,
  type NetPort,
  type NotifyPort,
  type ThemePort,
  type TransportsPort,
  type UiPort,
  type VehiclesPort,
} from '../../src/ext/api';
import { EXT_API_VERSION } from '../../src/version';

const EXT_ID = 'com.example.conformance';
const TEST_VERSION = '7.7.0';
const ALL_CONCRETE_PERMISSIONS: readonly Permission[] = [
  'telemetry:read',
  'mavlink:send',
  'command',
  'params:write',
  'mission:write',
  'ui:panel',
  'map',
  'notify',
  'files',
  'storage',
  'transport',
  'dialect',
  'net:example.com',
];

const READ_METHODS = new Set<string>([
  'vehicles.list',
  'vehicles.active',
  'vehicles.on',
  'mavlink.on',
  'mavlink.latest',
  'mavlink.rate',
  'mavlink.requestInterval',
  'params.get',
  'params.fetchAll',
  'params.onChange',
  'mission.download',
  'mission.onCurrent',
  'mission.onReached',
  'logs.openCurrentTlog',
  'logs.queryDataFlash',
]);

const UNPRIVILEGED_CONTEXT_METHODS = new Set<string>([
  'ui.h',
  'log.info',
  'log.warn',
  'log.error',
  'timers.setInterval',
  'timers.raf',
  'events.on',
  'events.emit',
  'onDispose',
]);

interface StorageSpies {
  get: ReturnType<typeof vi.fn<(key: string) => Promise<unknown | undefined>>>;
  set: ReturnType<typeof vi.fn<(key: string, value: unknown) => Promise<void>>>;
  del: ReturnType<typeof vi.fn<(key: string) => Promise<void>>>;
  clear: ReturnType<typeof vi.fn<() => Promise<void>>>;
}

interface Harness {
  services: ExtApiServices;
  broker: ReturnType<typeof createPermissionBroker>;
  grants: GrantStore;
  audit: ReturnType<typeof createAuditLog>;
  confirm: ReturnType<typeof vi.fn<ConfirmFn>>;
  recordEgress: ReturnType<typeof vi.fn<(info: EgressRecord) => void>>;
  dispose: DisposeRegistry;
  storageSpies: StorageSpies;
}

interface MethodCase {
  /** Invoke the method through the assembled trusted {@link ExtContext}. */
  invoke(ctx: ExtContext): unknown;
  /** Broker call arguments for permission-surface checks. */
  readonly brokerArgs: readonly unknown[];
  /** Assert that the expected backing fake observed the call. */
  verify(h: Harness): void;
}

/** In-memory {@link KvStore} keyed by `namespace\0key`. */
function fakeKv(): KvStore {
  const store = new Map<string, unknown>();
  const keyFor = (namespace: string, key: string): string => `${namespace}\u0000${key}`;
  return {
    get<T>(namespace: string, key: string): Promise<T | undefined> {
      return Promise.resolve(store.get(keyFor(namespace, key)) as T | undefined);
    },
    set<T>(namespace: string, key: string, value: T): Promise<void> {
      store.set(keyFor(namespace, key), value);
      return Promise.resolve();
    },
    del(namespace: string, key: string): Promise<void> {
      store.delete(keyFor(namespace, key));
      return Promise.resolve();
    },
  };
}

const vehicleStub: VehicleState = {
  sysid: 1,
  compid: 1,
  mavType: 2,
  autopilot: 3,
  vehicleClass: 'copter',
  armed: false,
  mode: 'STABILIZE',
  attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
  link: { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false },
  lastHeartbeatMs: 0,
};

const decodedStub: DecodedMessage = {
  sysid: 1,
  compid: 1,
  seq: 1,
  msgId: 0,
  name: 'HEARTBEAT',
  fields: {},
  crcOk: true,
  signed: false,
  rxTimeUs: 1,
  raw: new Uint8Array(),
};

const paramStub: Param = { name: 'PSC_POSXY_P', value: 1, type: 9 };
const missionStub: Mission = { type: 'mission', items: [] };
const layerStub: MapLayer = { id: 'layer', render: (): void => undefined };

const transportFactoryStub: TransportFactory = {
  id: 'echo',
  label: 'Echo',
  isSupported: () => true,
  configSchema: {},
  create(): Transport {
    return {
      id: 'echo',
      capabilities: { duplex: true, reconnect: false },
      open: () => Promise.resolve(),
      close: () => Promise.resolve(),
      readable: new ReadableStream<Uint8Array>(),
      writable: new WritableStream<Uint8Array>(),
      onState: () => () => undefined,
      stats: () => ({
        bytesIn: 0,
        bytesOut: 0,
        packetsIn: 0,
        lossPct: 0,
        rateHz: 0,
        signed: false,
      }),
    };
  },
};

function createStorage(): { storage: ExtKvStore; spies: StorageSpies } {
  const values = new Map<string, unknown>();
  const spies: StorageSpies = {
    get: vi.fn<(key: string) => Promise<unknown | undefined>>((key) =>
      Promise.resolve(values.get(key)),
    ),
    set: vi.fn<(key: string, value: unknown) => Promise<void>>((key, value) => {
      values.set(key, value);
      return Promise.resolve();
    }),
    del: vi.fn<(key: string) => Promise<void>>((key) => {
      values.delete(key);
      return Promise.resolve();
    }),
    clear: vi.fn<() => Promise<void>>(() => {
      values.clear();
      return Promise.resolve();
    }),
  };
  const storage: ExtKvStore = {
    get<T>(key: string): Promise<T | undefined> {
      return spies.get(key) as Promise<T | undefined>;
    },
    set<T>(key: string, value: T): Promise<void> {
      return spies.set(key, value);
    },
    del(key: string): Promise<void> {
      return spies.del(key);
    },
    clear(): Promise<void> {
      return spies.clear();
    },
  };
  return { storage, spies };
}

function fakeCommandClient(): CommandClient {
  return {
    send: vi.fn<CommandClient['send']>(() => Promise.resolve({ result: 0 })),
    arm: vi.fn<CommandClient['arm']>(() => Promise.resolve()),
    setMode: vi.fn<CommandClient['setMode']>(() => Promise.resolve()),
    takeoff: vi.fn<CommandClient['takeoff']>(() => Promise.resolve()),
    land: vi.fn<CommandClient['land']>(() => Promise.resolve()),
    rtl: vi.fn<CommandClient['rtl']>(() => Promise.resolve()),
    guidedGoto: vi.fn<CommandClient['guidedGoto']>(() => Promise.resolve()),
    setRoi: vi.fn<CommandClient['setRoi']>(() => Promise.resolve()),
    clearRoi: vi.fn<CommandClient['clearRoi']>(() => Promise.resolve()),
    setCurrentWp: vi.fn<CommandClient['setCurrentWp']>(() => Promise.resolve()),
  };
}

function fakeParamClient(): ParamClient {
  return {
    fetchAll: vi.fn<ParamClient['fetchAll']>(() => Promise.resolve([paramStub])),
    get: vi.fn<ParamClient['get']>(() => paramStub),
    set: vi.fn<ParamClient['set']>(() => Promise.resolve()),
    onChange: vi.fn<ParamClient['onChange']>(() => () => undefined),
  };
}

function fakeMissionClient(): MissionClient {
  return {
    download: vi.fn<MissionClient['download']>(() => Promise.resolve(missionStub)),
    upload: vi.fn<MissionClient['upload']>(() => Promise.resolve()),
    clear: vi.fn<MissionClient['clear']>(() => Promise.resolve()),
    setCurrent: vi.fn<MissionClient['setCurrent']>(() => Promise.resolve()),
    onCurrent: vi.fn<MissionClient['onCurrent']>(() => () => undefined),
    onReached: vi.fn<MissionClient['onReached']>(() => () => undefined),
  };
}

function fakeServices(): ExtApiServices {
  const connection: ConnectionPort = {
    state: vi.fn<ConnectionPort['state']>(() => ({ kind: 'closed' })),
    on: vi.fn<ConnectionPort['on']>(() => () => undefined),
  };
  const vehicles: VehiclesPort = {
    list: vi.fn<VehiclesPort['list']>(() => [vehicleStub]),
    active: vi.fn<VehiclesPort['active']>(() => vehicleStub),
    on: vi.fn<VehiclesPort['on']>(() => () => undefined),
  };
  const mavlink: MavlinkPort = {
    on: vi.fn<MavlinkPort['on']>(() => () => undefined),
    latest: vi.fn<MavlinkPort['latest']>(() => decodedStub),
    rate: vi.fn<MavlinkPort['rate']>(() => 1),
    requestInterval: vi.fn<MavlinkPort['requestInterval']>(),
    send: vi.fn<MavlinkPort['send']>(),
    loadDialect: vi.fn<MavlinkPort['loadDialect']>(),
  };
  const ui: UiPort = {
    registerPanel: vi.fn<UiPort['registerPanel']>(() => () => undefined),
    registerCommand: vi.fn<UiPort['registerCommand']>(() => () => undefined),
    addMenuItem: vi.fn<UiPort['addMenuItem']>(() => () => undefined),
    toast: vi.fn<UiPort['toast']>(),
    confirm: vi.fn<UiPort['confirm']>(() => Promise.resolve(true)),
    registerWidget: vi.fn<UiPort['registerWidget']>(() => () => undefined),
    h: vi.fn<UiPort['h']>((tag) => ({ tag })),
  };
  const notify: NotifyPort = {
    info: vi.fn<NotifyPort['info']>(),
    warn: vi.fn<NotifyPort['warn']>(),
    error: vi.fn<NotifyPort['error']>(),
  };
  const map = {
    addLayer: vi.fn<NonNullable<ExtApiServices['map']>['addLayer']>(() => () => undefined),
    on: vi.fn<NonNullable<ExtApiServices['map']>['on']>(() => () => undefined),
    setBasemap: vi.fn<NonNullable<ExtApiServices['map']>['setBasemap']>(),
    prefetch: vi.fn<NonNullable<ExtApiServices['map']>['prefetch']>(() => Promise.resolve()),
  };
  const theme: ThemePort = {
    register: vi.fn<ThemePort['register']>(() => () => undefined),
  };
  const logs: LogsPort = {
    openCurrentTlog: vi.fn<LogsPort['openCurrentTlog']>(() => 'tlog'),
    queryDataFlash: vi.fn<LogsPort['queryDataFlash']>(() => Promise.resolve([])),
  };
  const files: FilesPort = {
    openForRead: vi.fn<FilesPort['openForRead']>(() => Promise.resolve(new Blob(['x']))),
    saveAs: vi.fn<FilesPort['saveAs']>(() => Promise.resolve()),
  };
  const net: NetPort = {
    fetch: vi.fn<NetPort['fetch']>(() => Promise.resolve(new Response('ok'))),
  };
  const transports: TransportsPort = {
    register: vi.fn<TransportsPort['register']>(() => () => undefined),
  };
  return {
    connection,
    vehicles,
    mavlink,
    command: fakeCommandClient(),
    params: fakeParamClient(),
    mission: fakeMissionClient(),
    ui,
    notify,
    map,
    theme,
    logs,
    files,
    net,
    transports,
  };
}

async function createHarness(
  granted: readonly Permission[] = ALL_CONCRETE_PERMISSIONS,
): Promise<Harness> {
  const services = fakeServices();
  const grants = createGrantStore(fakeKv());
  await grants.set(EXT_ID, granted);
  const audit = createAuditLog();
  const confirm = vi.fn<ConfirmFn>(() => Promise.resolve(true));
  const recordEgress = vi.fn<(info: EgressRecord) => void>();
  const broker = createPermissionBroker({ grants, audit, confirm, recordEgress });
  const dispose = new DisposeRegistry();
  const { storage, spies } = createStorage();
  registerExtApi(broker, {
    services,
    storageFor: () => storage,
    disposeFor: () => dispose,
  });
  return { services, broker, grants, audit, confirm, recordEgress, dispose, storageSpies: spies };
}

function assemble(
  h: Harness,
  granted: readonly Permission[] = ALL_CONCRETE_PERMISSIONS,
): ExtContext {
  return assembleExtContext({
    extId: EXT_ID,
    granted: new Set<Permission>(granted),
    broker: h.broker,
    services: h.services,
    dispose: h.dispose,
    version: TEST_VERSION,
    log: {
      info: vi.fn<ExtContext['log']['info']>(),
      warn: vi.fn<ExtContext['log']['warn']>(),
      error: vi.fn<ExtContext['log']['error']>(),
    },
  });
}

async function settle(result: unknown): Promise<void> {
  if (result instanceof Promise) await result;
  await Promise.resolve();
  await Promise.resolve();
}

function valueAt(root: unknown, dotted: string): unknown {
  let current: unknown = root;
  for (const part of dotted.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function flattenMethodNames(root: unknown, prefix = ''): string[] {
  if (typeof root === 'function') return [prefix];
  if (typeof root !== 'object' || root === null) return [];
  const out: string[] = [];
  for (const [key, value] of Object.entries(root as Record<string, unknown>)) {
    const next = prefix.length === 0 ? key : `${prefix}.${key}`;
    out.push(...flattenMethodNames(value, next));
  }
  return out;
}

async function expectAbsentOrRejected(
  ctx: ExtContext,
  method: string,
  methodCase: MethodCase,
): Promise<void> {
  const member = valueAt(ctx, method);
  if (member === undefined) {
    expect(member).toBeUndefined();
    return;
  }

  try {
    const result = methodCase.invoke(ctx);
    if (result instanceof Promise) {
      await expect(result).rejects.toBeInstanceOf(ExtPermissionError);
      return;
    }
    throw new Error(`ungranted method ${method} unexpectedly returned`);
  } catch (err) {
    expect(err).toBeInstanceOf(ExtPermissionError);
  }
}

const METHOD_CASES: Readonly<Record<string, MethodCase>> = {
  'connection.state': {
    brokerArgs: [],
    invoke: (ctx) => ctx.connection.state(),
    verify: (h) => expect(h.services.connection.state).toHaveBeenCalled(),
  },
  'connection.on': {
    brokerArgs: [() => undefined],
    invoke: (ctx) => ctx.connection.on('state', () => undefined),
    verify: (h) => expect(h.services.connection.on).toHaveBeenCalled(),
  },
  'vehicles.list': {
    brokerArgs: [],
    invoke: (ctx) => ctx.vehicles.list(),
    verify: (h) => expect(h.services.vehicles.list).toHaveBeenCalled(),
  },
  'vehicles.active': {
    brokerArgs: [],
    invoke: (ctx) => ctx.vehicles.active(),
    verify: (h) => expect(h.services.vehicles.active).toHaveBeenCalled(),
  },
  'vehicles.on': {
    brokerArgs: [() => undefined],
    invoke: (ctx) => ctx.vehicles.on('change', () => undefined),
    verify: (h) => expect(h.services.vehicles.on).toHaveBeenCalled(),
  },
  'mavlink.on': {
    brokerArgs: ['HEARTBEAT', () => undefined, { rateHz: 1 }],
    invoke: (ctx) => ctx.mavlink.on('HEARTBEAT', () => undefined, { rateHz: 1 }),
    verify: (h) => expect(h.services.mavlink.on).toHaveBeenCalled(),
  },
  'mavlink.latest': {
    brokerArgs: ['HEARTBEAT'],
    invoke: (ctx) => ctx.mavlink.latest('HEARTBEAT'),
    verify: (h) => expect(h.services.mavlink.latest).toHaveBeenCalledWith('HEARTBEAT'),
  },
  'mavlink.rate': {
    brokerArgs: ['HEARTBEAT'],
    invoke: (ctx) => ctx.mavlink.rate('HEARTBEAT'),
    verify: (h) => expect(h.services.mavlink.rate).toHaveBeenCalledWith('HEARTBEAT'),
  },
  'mavlink.requestInterval': {
    brokerArgs: ['HEARTBEAT', 2],
    invoke: (ctx) => ctx.mavlink.requestInterval('HEARTBEAT', 2),
    verify: (h) => expect(h.services.mavlink.requestInterval).toHaveBeenCalledWith('HEARTBEAT', 2),
  },
  'mavlink.send': {
    brokerArgs: ['COMMAND_LONG', { command: 400 }, { signed: true }],
    invoke: (ctx) => ctx.mavlink.send?.('COMMAND_LONG', { command: 400 }, { signed: true }),
    verify: (h) =>
      expect(h.services.mavlink.send).toHaveBeenCalledWith(
        'COMMAND_LONG',
        { command: 400 },
        { signed: true },
      ),
  },
  'mavlink.loadDialect': {
    brokerArgs: ['<mavlink/>'],
    invoke: (ctx) => ctx.mavlink.loadDialect?.('<mavlink/>'),
    verify: (h) => expect(h.services.mavlink.loadDialect).toHaveBeenCalledWith('<mavlink/>'),
  },
  'command.send': {
    brokerArgs: [400, [1, 0, 0], { int: false }],
    invoke: (ctx) => ctx.command?.send(400, [1, 0, 0], { int: false }),
    verify: (h) =>
      expect(h.services.command.send).toHaveBeenCalledWith(400, [1, 0, 0], { int: false }),
  },
  'command.arm': {
    brokerArgs: [true, false],
    invoke: (ctx) => ctx.command?.arm(true, false),
    verify: (h) => expect(h.services.command.arm).toHaveBeenCalledWith(true, false),
  },
  'command.setMode': {
    brokerArgs: ['GUIDED'],
    invoke: (ctx) => ctx.command?.setMode('GUIDED'),
    verify: (h) => expect(h.services.command.setMode).toHaveBeenCalledWith('GUIDED'),
  },
  'command.takeoff': {
    brokerArgs: [12],
    invoke: (ctx) => ctx.command?.takeoff(12),
    verify: (h) => expect(h.services.command.takeoff).toHaveBeenCalledWith(12),
  },
  'command.land': {
    brokerArgs: [],
    invoke: (ctx) => ctx.command?.land(),
    verify: (h) => expect(h.services.command.land).toHaveBeenCalled(),
  },
  'command.rtl': {
    brokerArgs: [],
    invoke: (ctx) => ctx.command?.rtl(),
    verify: (h) => expect(h.services.command.rtl).toHaveBeenCalled(),
  },
  'command.guidedGoto': {
    brokerArgs: [47.1, 8.2, 30],
    invoke: (ctx) => ctx.command?.guidedGoto(47.1, 8.2, 30),
    verify: (h) => expect(h.services.command.guidedGoto).toHaveBeenCalledWith(47.1, 8.2, 30),
  },
  'command.setRoi': {
    brokerArgs: [47.1, 8.2, 30],
    invoke: (ctx) => ctx.command?.setRoi(47.1, 8.2, 30),
    verify: (h) => expect(h.services.command.setRoi).toHaveBeenCalledWith(47.1, 8.2, 30),
  },
  'command.clearRoi': {
    brokerArgs: [],
    invoke: (ctx) => ctx.command?.clearRoi(),
    verify: (h) => expect(h.services.command.clearRoi).toHaveBeenCalled(),
  },
  'command.setCurrentWp': {
    brokerArgs: [3],
    invoke: (ctx) => ctx.command?.setCurrentWp(3),
    verify: (h) => expect(h.services.command.setCurrentWp).toHaveBeenCalledWith(3),
  },
  'params.get': {
    brokerArgs: ['PSC_POSXY_P'],
    invoke: (ctx) => ctx.params?.get('PSC_POSXY_P'),
    verify: (h) => expect(h.services.params.get).toHaveBeenCalledWith('PSC_POSXY_P'),
  },
  'params.fetchAll': {
    brokerArgs: [undefined, undefined],
    invoke: (ctx) => ctx.params?.fetchAll(),
    verify: (h) => expect(h.services.params.fetchAll).toHaveBeenCalled(),
  },
  'params.onChange': {
    brokerArgs: [() => undefined],
    invoke: (ctx) => ctx.params?.onChange(() => undefined),
    verify: (h) => expect(h.services.params.onChange).toHaveBeenCalled(),
  },
  'params.set': {
    brokerArgs: ['PSC_POSXY_P', 2],
    invoke: (ctx) => ctx.params?.set('PSC_POSXY_P', 2),
    verify: (h) => expect(h.services.params.set).toHaveBeenCalledWith('PSC_POSXY_P', 2),
  },
  'mission.download': {
    brokerArgs: ['mission', undefined, undefined],
    invoke: (ctx) => ctx.mission?.download('mission'),
    verify: (h) => expect(h.services.mission.download).toHaveBeenCalled(),
  },
  'mission.onCurrent': {
    brokerArgs: [() => undefined],
    invoke: (ctx) => ctx.mission?.onCurrent(() => undefined),
    verify: (h) => expect(h.services.mission.onCurrent).toHaveBeenCalled(),
  },
  'mission.onReached': {
    brokerArgs: [() => undefined],
    invoke: (ctx) => ctx.mission?.onReached(() => undefined),
    verify: (h) => expect(h.services.mission.onReached).toHaveBeenCalled(),
  },
  'mission.upload': {
    brokerArgs: [missionStub, { verify: true }],
    invoke: (ctx) => ctx.mission?.upload(missionStub, { verify: true }),
    verify: (h) =>
      expect(h.services.mission.upload).toHaveBeenCalledWith(missionStub, { verify: true }),
  },
  'mission.clear': {
    brokerArgs: ['mission'],
    invoke: (ctx) => ctx.mission?.clear('mission'),
    verify: (h) => expect(h.services.mission.clear).toHaveBeenCalledWith('mission'),
  },
  'mission.setCurrent': {
    brokerArgs: [4],
    invoke: (ctx) => ctx.mission?.setCurrent(4),
    verify: (h) => expect(h.services.mission.setCurrent).toHaveBeenCalledWith(4),
  },
  'ui.registerPanel': {
    brokerArgs: [{ id: 'panel', title: 'Panel', mount: () => undefined }],
    invoke: (ctx) => ctx.ui?.registerPanel({ id: 'panel', title: 'Panel', mount: () => undefined }),
    verify: (h) => expect(h.services.ui.registerPanel).toHaveBeenCalled(),
  },
  'ui.registerWidget': {
    brokerArgs: ['battery', { compact: true }],
    invoke: (ctx) => ctx.ui?.registerWidget('battery', { compact: true }),
    verify: (h) =>
      expect(h.services.ui.registerWidget).toHaveBeenCalledWith('battery', { compact: true }),
  },
  'ui.registerCommand': {
    brokerArgs: [{ id: 'cmd', title: 'Command', run: () => undefined }],
    invoke: (ctx) => ctx.ui?.registerCommand({ id: 'cmd', title: 'Command', run: () => undefined }),
    verify: (h) => expect(h.services.ui.registerCommand).toHaveBeenCalled(),
  },
  'ui.addMenuItem': {
    brokerArgs: ['tools', { id: 'menu', title: 'Menu', run: () => undefined }],
    invoke: (ctx) =>
      ctx.ui?.addMenuItem('tools', { id: 'menu', title: 'Menu', run: () => undefined }),
    verify: (h) => expect(h.services.ui.addMenuItem).toHaveBeenCalled(),
  },
  'ui.confirm': {
    brokerArgs: [{ title: 'Confirm', body: 'Proceed?' }],
    invoke: (ctx) => ctx.ui?.confirm({ title: 'Confirm', body: 'Proceed?' }),
    verify: (h) =>
      expect(h.services.ui.confirm).toHaveBeenCalledWith({ title: 'Confirm', body: 'Proceed?' }),
  },
  'ui.toast': {
    brokerArgs: ['info', 'hello'],
    invoke: (ctx) => ctx.ui?.toast('info', 'hello'),
    verify: (h) => expect(h.services.ui.toast).toHaveBeenCalledWith('info', 'hello'),
  },
  'notify.info': {
    brokerArgs: ['hello'],
    invoke: (ctx) => ctx.notify.info('hello'),
    verify: (h) => expect(h.services.notify.info).toHaveBeenCalledWith('hello'),
  },
  'notify.warn': {
    brokerArgs: ['careful'],
    invoke: (ctx) => ctx.notify.warn('careful'),
    verify: (h) => expect(h.services.notify.warn).toHaveBeenCalledWith('careful'),
  },
  'notify.error': {
    brokerArgs: ['boom'],
    invoke: (ctx) => ctx.notify.error('boom'),
    verify: (h) => expect(h.services.notify.error).toHaveBeenCalledWith('boom'),
  },
  'map.addLayer': {
    brokerArgs: [layerStub],
    invoke: (ctx) => ctx.map?.addLayer(layerStub),
    verify: (h) => expect(h.services.map?.addLayer).toHaveBeenCalledWith(layerStub),
  },
  'map.on': {
    brokerArgs: ['click', () => undefined],
    invoke: (ctx) => ctx.map?.on('click', () => undefined),
    verify: (h) => expect(h.services.map?.on).toHaveBeenCalled(),
  },
  'map.setBasemap': {
    brokerArgs: [{ id: 'osm', kind: 'xyz', url: 'https://tiles.example/{z}/{x}/{y}.png' }],
    invoke: (ctx) =>
      ctx.map?.setBasemap({ id: 'osm', kind: 'xyz', url: 'https://tiles.example/{z}/{x}/{y}.png' }),
    verify: (h) => expect(h.services.map?.setBasemap).toHaveBeenCalled(),
  },
  'map.prefetch': {
    brokerArgs: [[0, 0, 1, 1] satisfies Bbox, [1, 3]],
    invoke: (ctx) => ctx.map?.prefetch([0, 0, 1, 1], [1, 3]),
    verify: (h) => expect(h.services.map?.prefetch).toHaveBeenCalledWith([0, 0, 1, 1], [1, 3]),
  },
  'theme.register': {
    brokerArgs: [{ color: 'red' }],
    invoke: (ctx) => ctx.theme?.register({ color: 'red' }),
    verify: (h) => expect(h.services.theme?.register).toHaveBeenCalledWith({ color: 'red' }),
  },
  'logs.openCurrentTlog': {
    brokerArgs: [],
    invoke: (ctx) => ctx.logs?.openCurrentTlog(),
    verify: (h) => expect(h.services.logs?.openCurrentTlog).toHaveBeenCalled(),
  },
  'logs.queryDataFlash': {
    brokerArgs: ['GPS.Lat > 0', [0, 10]],
    invoke: (ctx) => ctx.logs?.queryDataFlash('GPS.Lat > 0', [0, 10]),
    verify: (h) =>
      expect(h.services.logs?.queryDataFlash).toHaveBeenCalledWith('GPS.Lat > 0', [0, 10]),
  },
  'storage.get': {
    brokerArgs: ['k'],
    invoke: (ctx) => ctx.storage.get('k'),
    verify: (h) => expect(h.storageSpies.get).toHaveBeenCalledWith('k'),
  },
  'storage.set': {
    brokerArgs: ['k', 'v'],
    invoke: (ctx) => ctx.storage.set('k', 'v'),
    verify: (h) => expect(h.storageSpies.set).toHaveBeenCalledWith('k', 'v'),
  },
  'files.openForRead': {
    brokerArgs: [],
    invoke: (ctx) => ctx.files?.openForRead(),
    verify: (h) => expect(h.services.files?.openForRead).toHaveBeenCalled(),
  },
  'files.saveAs': {
    brokerArgs: [new Blob(['x']), 'file.bin'],
    invoke: (ctx) => ctx.files?.saveAs(new Blob(['x']), 'file.bin'),
    verify: (h) => expect(h.services.files?.saveAs).toHaveBeenCalled(),
  },
  'net.fetch': {
    brokerArgs: ['https://example.com/data.json', { method: 'GET' }],
    invoke: (ctx) => ctx.net?.fetch('https://example.com/data.json', { method: 'GET' }),
    verify: (h) => {
      expect(h.services.net?.fetch).toHaveBeenCalledWith('https://example.com/data.json', {
        method: 'GET',
      });
      expect(h.recordEgress).toHaveBeenCalledWith(
        expect.objectContaining({ extId: EXT_ID, host: 'example.com' }),
      );
    },
  },
  'transports.register': {
    brokerArgs: [transportFactoryStub],
    invoke: (ctx) => ctx.transports?.register(transportFactoryStub),
    verify: (h) =>
      expect(h.services.transports?.register).toHaveBeenCalledWith(transportFactoryStub),
  },
};

describe('Extension API conformance over CAPABILITY_MAP', () => {
  it('has one executable case for every mapped API method', () => {
    expect(Object.keys(METHOD_CASES).sort()).toEqual(
      CAPABILITY_MAP.map((spec) => spec.method).sort(),
    );
  });

  it.each(CAPABILITY_MAP)('exposes and calls through $method when granted', async (spec) => {
    const h = await createHarness();
    const ctx = assemble(h);
    const methodCase = METHOD_CASES[spec.method];
    expect(methodCase).toBeDefined();
    if (methodCase === undefined) return;

    expect(valueAt(ctx, spec.method)).toEqual(expect.any(Function));
    await settle(methodCase.invoke(ctx));
    methodCase.verify(h);
  });

  it.each(CAPABILITY_MAP)('omits or rejects $method when not granted', async (spec) => {
    const h = await createHarness([]);
    const ctx = assemble(h, []);
    const methodCase = METHOD_CASES[spec.method];
    expect(methodCase).toBeDefined();
    if (methodCase === undefined) return;

    const caps = await h.broker.capabilitiesFor(EXT_ID);
    if (spec.permission === null && !spec.net) {
      expect(caps.has(spec.method)).toBe(true);
      await h.broker.invoke(EXT_ID, spec.method, methodCase.brokerArgs);
      expect(valueAt(ctx, spec.method)).toEqual(expect.any(Function));
      return;
    }

    expect(caps.has(spec.method)).toBe(false);
    await expect(
      h.broker.invoke(EXT_ID, spec.method, methodCase.brokerArgs),
    ).rejects.toBeInstanceOf(ExtPermissionError);
    await expectAbsentOrRejected(ctx, spec.method, methodCase);
  });

  it('classifies every telemetry read under telemetry:read', () => {
    for (const method of READ_METHODS) {
      const spec = CAPABILITY_MAP.find((candidate) => candidate.method === method);
      expect(spec, `${method} must be in CAPABILITY_MAP`).toBeDefined();
      expect(spec?.permission).toBe('telemetry:read');
    }
  });

  it.each(
    CAPABILITY_MAP.filter(
      (spec) => spec.permission !== null && VEHICLE_AFFECTING_PERMISSIONS.has(spec.permission),
    ),
  )('routes vehicle-affecting $method through confirm + audit', async (spec) => {
    const methodCase = METHOD_CASES[spec.method];
    expect(methodCase).toBeDefined();
    if (methodCase === undefined) return;
    const h = await createHarness(ALL_CONCRETE_PERMISSIONS);

    await h.broker.invoke(EXT_ID, spec.method, methodCase.brokerArgs);

    expect(h.confirm).toHaveBeenCalledTimes(1);
    const entries = h.audit.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.origin).toBe(EXT_ID);
    expect(entries[0]?.status).toBe('ok');
  });
});

describe('ExtContext frozen shape conformance', () => {
  const expectedTopLevelAllGranted = [
    'command',
    'connection',
    'events',
    'files',
    'log',
    'logs',
    'map',
    'mavlink',
    'mission',
    'net',
    'notify',
    'onDispose',
    'params',
    'storage',
    'theme',
    'timers',
    'transports',
    'ui',
    'vehicles',
    'version',
  ];

  it('returns the frozen ExtContext type', async () => {
    const h = await createHarness();
    const ctx = assemble(h);
    expectTypeOf(ctx).toEqualTypeOf<ExtContext>();
    expectTypeOf<typeof assembleExtContext>().returns.toEqualTypeOf<ExtContext>();
  });

  it('matches representative runtime shapes for all, none, and mixed grants', async () => {
    const all = assemble(await createHarness(), ALL_CONCRETE_PERMISSIONS);
    expect(Object.keys(all).sort()).toEqual(expectedTopLevelAllGranted);
    expect(Object.keys(all.mavlink).sort()).toEqual([
      'latest',
      'loadDialect',
      'on',
      'rate',
      'requestInterval',
      'send',
    ]);
    expect(Object.keys(all.ui ?? {}).sort()).toEqual([
      'addMenuItem',
      'confirm',
      'h',
      'registerCommand',
      'registerPanel',
      'registerWidget',
      'toast',
    ]);

    const none = assemble(await createHarness([]), []);
    expect(Object.keys(none).sort()).toEqual([
      'connection',
      'events',
      'log',
      'mavlink',
      'notify',
      'onDispose',
      'storage',
      'timers',
      'vehicles',
      'version',
    ]);
    expect(none.command).toBeUndefined();
    expect(none.params).toBeUndefined();
    expect(none.mavlink.send).toBeUndefined();

    const readOnly = assemble(await createHarness(['telemetry:read', 'notify']), [
      'telemetry:read',
      'notify',
    ]);
    expect(readOnly.params).toBeDefined();
    expect(readOnly.mission).toBeDefined();
    expect(readOnly.logs).toBeDefined();
    expect(readOnly.command).toBeUndefined();
    expect(readOnly.ui).toBeUndefined();
    expect(readOnly.notify.info).toEqual(expect.any(Function));

    const planner = assemble(await createHarness(['mission:write', 'map', 'files']), [
      'mission:write',
      'map',
      'files',
    ]);
    expect(planner.mission).toBeDefined();
    expect(planner.map).toBeDefined();
    expect(planner.files).toBeDefined();
    expect(planner.params).toBeUndefined();
    expect(planner.logs).toBeUndefined();
    expect(planner.net).toBeUndefined();
  });

  it('covers every privileged ExtContext method with CAPABILITY_MAP', async () => {
    const ctx = assemble(await createHarness(), ALL_CONCRETE_PERMISSIONS);
    const publicMethods = flattenMethodNames(ctx).filter(
      (method) => !UNPRIVILEGED_CONTEXT_METHODS.has(method),
    );
    expect(publicMethods.sort()).toEqual(CAPABILITY_MAP.map((spec) => spec.method).sort());
  });
});

describe('extension API version and declaration stability', () => {
  it('surfaces EXT_API_VERSION and documents the top-level groups in the bundled .d.ts', () => {
    expect(EXT_API_VERSION).toMatch(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/);
    const dts = buildExtApiDts();
    expect(dts).toContain(`v${EXT_API_VERSION}`);
    expect(dts).not.toContain('__EXT_API_VERSION__');
    for (const group of [
      'connection',
      'vehicles',
      'mavlink',
      'command',
      'params',
      'mission',
      'ui',
      'map',
      'theme',
      'logs',
      'storage',
      'files',
      'net',
      'transports',
      'notify',
      'log',
      'timers',
      'events',
    ]) {
      expect(dts).toMatch(new RegExp(`\\b${group}\\??:`));
    }
    expect(dts).toContain('onDispose(fn: () => void): void;');
    expect(dts).toContain('declare const mvp: ExtContext;');
    expect(dts).toContain('declare const ctx: ExtContext;');
  });
});
