/**
 * Unit tests for the T7.3 `mvp`/`ctx` extension API (spec plan/06 §6.4/§6.5/§6.10).
 *
 * Pure / in-process: fake services (typed `vi.fn` ports), the real
 * {@link RingAuditLog} + {@link PermissionBroker} + grant store, and the trivial
 * in-process runtime. Covers the capability-map registration, granted/ungranted
 * gating, the brokered `params.set` audit, `net.fetch` egress gating, the
 * assembled `ctx` shape per grant set, the wired {@link createExtensionSystem}
 * (install → activate → register a panel via `ctx.ui`), and the bundled `.d.ts`.
 */
import { describe, it, expect, vi } from 'vitest';
import type {
  CommandClient,
  ExtContext,
  ExtManifest,
  MissionClient,
  Param,
  ParamClient,
  Permission,
  VehicleState,
} from '../../src/contracts';
import { createAuditLog } from '../../src/core/audit';
import { DisposeRegistry, createExtKvStore } from '../../src/ext/host';
import {
  ExtPermissionError,
  createGrantStore,
  createPermissionBroker,
  type ConfirmFn,
  type EgressRecord,
} from '../../src/ext/permissions';
import {
  CAPABILITY_MAP,
  EXT_API_DTS,
  assembleExtContext,
  buildExtApiDts,
  createExtensionSystem,
  registerExtApi,
  type ExtApiServices,
} from '../../src/ext/api';
import { fakeKv } from '../helpers';

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

const paramStub: Param = { name: 'PSC_POSXY_P', value: 1, type: 9 };

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
    download: vi.fn<MissionClient['download']>(() =>
      Promise.resolve({ type: 'mission', items: [] }),
    ),
    upload: vi.fn<MissionClient['upload']>(() => Promise.resolve()),
    clear: vi.fn<MissionClient['clear']>(() => Promise.resolve()),
    setCurrent: vi.fn<MissionClient['setCurrent']>(() => Promise.resolve()),
    onCurrent: vi.fn<MissionClient['onCurrent']>(() => () => undefined),
    onReached: vi.fn<MissionClient['onReached']>(() => () => undefined),
  };
}

function fakeServices(over: Partial<ExtApiServices> = {}): ExtApiServices {
  const services: ExtApiServices = {
    connection: { state: () => ({ kind: 'closed' }), on: () => () => undefined },
    vehicles: { list: () => [vehicleStub], active: () => vehicleStub, on: () => () => undefined },
    mavlink: {
      on: () => () => undefined,
      latest: () => undefined,
      rate: () => 0,
      requestInterval: vi.fn<(name: string, hz: number) => void>(),
      send: vi.fn<(name: string, fields: Record<string, unknown>) => void>(),
      loadDialect: vi.fn<(src: string) => void>(),
    },
    command: fakeCommandClient(),
    params: fakeParamClient(),
    mission: fakeMissionClient(),
    ui: {
      registerPanel: vi.fn<ExtApiServices['ui']['registerPanel']>(() => () => undefined),
      registerCommand: vi.fn<ExtApiServices['ui']['registerCommand']>(() => () => undefined),
      addMenuItem: vi.fn<ExtApiServices['ui']['addMenuItem']>(() => () => undefined),
      registerWidget: vi.fn<ExtApiServices['ui']['registerWidget']>(() => () => undefined),
      toast: vi.fn<ExtApiServices['ui']['toast']>(),
      confirm: vi.fn<ExtApiServices['ui']['confirm']>(() => Promise.resolve(true)),
      h: (tag: string): unknown => ({ tag }),
    },
    notify: {
      info: vi.fn<(m: string) => void>(),
      warn: vi.fn<(m: string) => void>(),
      error: vi.fn<(m: string) => void>(),
    },
    map: {
      addLayer: () => () => undefined,
      on: () => () => undefined,
      setBasemap: () => undefined,
      prefetch: () => Promise.resolve(),
    },
    theme: { register: () => () => undefined },
    logs: { openCurrentTlog: () => 'tlog', queryDataFlash: () => Promise.resolve([]) },
    files: {
      openForRead: () => Promise.resolve(new Blob(['x'])),
      saveAs: vi.fn<(b: Blob, name: string) => Promise<void>>(() => Promise.resolve()),
    },
    net: {
      fetch: vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(() =>
        Promise.resolve(new Response('ok')),
      ),
    },
    transports: { register: () => () => undefined },
    ...over,
  };
  return services;
}

interface Harness {
  services: ExtApiServices;
  broker: ReturnType<typeof createPermissionBroker>;
  grants: ReturnType<typeof createGrantStore>;
  audit: ReturnType<typeof createAuditLog>;
  confirm: ReturnType<typeof vi.fn<ConfirmFn>>;
  recordEgress: ReturnType<typeof vi.fn<(i: EgressRecord) => void>>;
  dispose: DisposeRegistry;
}

function harness(): Harness {
  const services = fakeServices();
  const grants = createGrantStore(fakeKv());
  const audit = createAuditLog();
  const confirm = vi.fn<ConfirmFn>(() => Promise.resolve(true));
  const recordEgress = vi.fn<(i: EgressRecord) => void>();
  const broker = createPermissionBroker({ grants, audit, confirm, recordEgress });
  const dispose = new DisposeRegistry();
  const storage = createExtKvStore(fakeKv(), 'data');
  registerExtApi(broker, {
    services,
    storageFor: () => storage,
    disposeFor: () => dispose,
  });
  return { services, broker, grants, audit, confirm, recordEgress, dispose };
}

describe('registerExtApi capability map', () => {
  it('registers every capability-map method on the broker', () => {
    const { broker } = harness();
    const registered = new Set(broker.registeredMethods());
    expect(registered.size).toBe(CAPABILITY_MAP.length);
    for (const spec of CAPABILITY_MAP) expect(registered.has(spec.method)).toBe(true);
  });

  it('skips a method whose optional service is absent', () => {
    const services = fakeServices();
    delete services.map;
    delete services.net;
    const grants = createGrantStore(fakeKv());
    const broker = createPermissionBroker({
      grants,
      audit: createAuditLog(),
      confirm: vi.fn<ConfirmFn>(() => Promise.resolve(true)),
    });
    const off = registerExtApi(broker, {
      services,
      storageFor: () => createExtKvStore(fakeKv(), 'd'),
      disposeFor: () => undefined,
    });
    const registered = new Set(broker.registeredMethods());
    expect(registered.has('map.addLayer')).toBe(false);
    expect(registered.has('net.fetch')).toBe(false);
    expect(registered.has('command.arm')).toBe(true);
    off();
    expect(broker.registeredMethods()).toEqual([]);
  });
});

describe('permission gating', () => {
  it('a granted params.set calls the ParamClient and audits it', async () => {
    const { broker, grants, audit, services, confirm } = harness();
    await grants.grant('ext.a', ['params:write']);

    await broker.invoke('ext.a', 'params.set', ['PSC_POSXY_P', 2.5]);

    expect(services.params.set).toHaveBeenCalledWith('PSC_POSXY_P', 2.5);
    expect(confirm).toHaveBeenCalledTimes(1);
    const entries = audit.list();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.kind).toBe('param-set');
    expect(entries[0]?.origin).toBe('ext.a');
    expect(entries[0]?.status).toBe('ok');
  });

  it('an ungranted method is absent from capabilitiesFor and rejected by invoke', async () => {
    const { broker, grants } = harness();
    await grants.grant('ext.a', ['telemetry:read']);
    const caps = await broker.capabilitiesFor('ext.a');
    expect(caps.has('mavlink.latest')).toBe(true);
    expect(caps.has('params.set')).toBe(false);
    expect(caps.has('command.arm')).toBe(false);

    await expect(broker.invoke('ext.a', 'params.set', ['X', 1])).rejects.toBeInstanceOf(
      ExtPermissionError,
    );
  });

  it('reads gate behind telemetry:read', async () => {
    const { broker, grants } = harness();
    await expect(broker.invoke('ext.a', 'mavlink.latest', ['HEARTBEAT'])).rejects.toBeInstanceOf(
      ExtPermissionError,
    );
    await grants.grant('ext.a', ['telemetry:read']);
    await expect(broker.invoke('ext.a', 'mavlink.latest', ['HEARTBEAT'])).resolves.toBeUndefined();
  });

  it('net.fetch is egress-gated against net:<host> grants', async () => {
    const { broker, grants, services, recordEgress } = harness();
    await expect(
      broker.invoke('ext.a', 'net.fetch', ['https://example.com/data']),
    ).rejects.toBeInstanceOf(ExtPermissionError);
    expect(services.net?.fetch).not.toHaveBeenCalled();

    await grants.grant('ext.a', ['net:example.com']);
    await broker.invoke('ext.a', 'net.fetch', ['https://example.com/data']);
    expect(services.net?.fetch).toHaveBeenCalledTimes(1);
    expect(recordEgress).toHaveBeenCalledWith(
      expect.objectContaining({ extId: 'ext.a', host: 'example.com' }),
    );
  });
});

describe('assembleExtContext shape', () => {
  function build(granted: Permission[]): ExtContext {
    const { broker, services } = harness();
    return assembleExtContext({
      extId: 'ext.a',
      granted: new Set<Permission>(granted),
      broker,
      services,
      dispose: new DisposeRegistry(),
      version: '1.2.3',
    });
  }

  it('omits optional groups when their permission is not granted', () => {
    const ctx = build([]);
    expect(ctx.version).toBe('1.2.3');
    expect(ctx.connection).toBeDefined();
    expect(ctx.storage).toBeDefined();
    expect(ctx.notify).toBeDefined();
    expect(ctx.command).toBeUndefined();
    expect(ctx.params).toBeUndefined();
    expect(ctx.mission).toBeUndefined();
    expect(ctx.ui).toBeUndefined();
    expect(ctx.map).toBeUndefined();
    expect(ctx.net).toBeUndefined();
    expect(ctx.mavlink.send).toBeUndefined();
    expect(ctx.mavlink.loadDialect).toBeUndefined();
  });

  it('exposes a group exactly when its permission is granted', () => {
    const ctx = build([
      'telemetry:read',
      'command',
      'params:write',
      'mission:write',
      'ui:panel',
      'map',
      'mavlink:send',
      'dialect',
      'files',
      'transport',
      'net:*',
    ]);
    expect(ctx.command).toBeDefined();
    expect(ctx.params).toBeDefined();
    expect(ctx.mission).toBeDefined();
    expect(ctx.ui).toBeDefined();
    expect(ctx.map).toBeDefined();
    expect(ctx.theme).toBeDefined();
    expect(ctx.logs).toBeDefined();
    expect(ctx.files).toBeDefined();
    expect(ctx.net).toBeDefined();
    expect(ctx.transports).toBeDefined();
    expect(ctx.mavlink.send).toBeDefined();
    expect(ctx.mavlink.loadDialect).toBeDefined();
  });

  it('always-present reads throw when telemetry:read is missing', () => {
    const ctx = build([]);
    expect(() => ctx.vehicles.list()).toThrow(ExtPermissionError);
    expect(() => ctx.mavlink.latest('HEARTBEAT')).toThrow(ExtPermissionError);
    expect(ctx.connection.state()).toEqual({ kind: 'closed' });
  });
});

describe('createExtensionSystem', () => {
  const manifest: ExtManifest = {
    id: 'com.example.panel',
    name: 'Panel demo',
    version: '1.0.0',
    apiVersion: '^1.0',
    permissions: ['ui:panel'],
    contributes: { panels: [{ id: 'demo', title: 'Demo' }] },
  };

  it('installs + activates an extension whose activate() gets a brokered ctx and registers a panel', async () => {
    const services = fakeServices();
    const system = createExtensionSystem({
      storage: fakeKv(),
      services,
      confirm: vi.fn<ConfirmFn>(() => Promise.resolve(true)),
      now: () => 1000,
    });

    let received: ExtContext | undefined;
    await system.install({
      manifest,
      module: {
        manifest,
        activate: (ctx: ExtContext): void => {
          received = ctx;
          ctx.ui?.registerPanel({ id: 'demo', title: 'Demo', mount: () => undefined });
        },
      },
    });
    await system.setGrants(manifest.id, ['ui:panel']);
    const state = await system.activate(manifest.id);

    expect(state.status).toBe('active');
    expect(received).toBeDefined();
    expect(received?.ui).toBeDefined();
    expect(received?.command).toBeUndefined();
    expect(services.ui.registerPanel).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'demo', title: 'Demo' }),
    );

    // Teardown removes the registration (disposer tracked in the host registry).
    await system.disable(manifest.id);
    system.dispose();
  });

  it('routes a granted vehicle-affecting call through the broker (confirm + audit)', async () => {
    const services = fakeServices();
    const audit = createAuditLog();
    const confirm = vi.fn<ConfirmFn>(() => Promise.resolve(true));
    const system = createExtensionSystem({
      storage: fakeKv(),
      services,
      confirm,
      audit,
      now: () => 1000,
    });

    const cmdManifest: ExtManifest = {
      ...manifest,
      id: 'com.example.arm',
      permissions: ['command'],
    };
    await system.install({
      manifest: cmdManifest,
      module: {
        manifest: cmdManifest,
        activate: async (ctx: ExtContext): Promise<void> => {
          await ctx.command?.arm(true);
        },
      },
    });
    await system.setGrants(cmdManifest.id, ['command']);
    await system.activate(cmdManifest.id);

    expect(services.command.arm).toHaveBeenCalledWith(true, undefined);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(audit.list().some((e) => e.origin === cmdManifest.id && e.status === 'ok')).toBe(true);
    system.dispose();
  });
});

describe('bundled .d.ts', () => {
  const PERMISSIONS: readonly string[] = [
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
  ];

  it('injects the version and declares the mvp/ctx globals + ExtContext', () => {
    const dts = buildExtApiDts('9.9.9');
    expect(dts).toContain('v9.9.9');
    expect(dts).not.toContain('__EXT_API_VERSION__');
    expect(dts).toContain('interface ExtContext');
    expect(dts).toContain('declare const mvp: ExtContext;');
    expect(dts).toContain('declare const ctx: ExtContext;');
    expect(dts).toContain('net:${string}');
  });

  it('declares every Permission scope from the frozen contract', () => {
    for (const p of PERMISSIONS) expect(EXT_API_DTS).toContain(`'${p}'`);
  });

  it('stays in sync with the contract source (no stale intra-bundle imports)', () => {
    expect(EXT_API_DTS).not.toMatch(/import type \{[\s\S]*?\} from '\.\//);
    // Distinctive lines from the current contract must be reflected verbatim.
    expect(EXT_API_DTS).toContain('connection: {');
    expect(EXT_API_DTS).toContain('onDispose(fn: () => void): void;');
    expect(EXT_API_DTS).toContain('interface PanelContribution');
  });
});
