/**
 * Smoke tests for T7.6 first-party example extensions.
 *
 * Each example is installed and activated through the real T7.3
 * {@link createExtensionSystem} with only its declared grants. The tests double
 * as living API conformance: static manifest contributions are matched by the
 * runtime registration API that owns the executable implementation.
 */
import { describe, it, expect, vi } from 'vitest';
import type {
  CommandClient,
  DecodedMessage,
  ExtManifest,
  FieldValue,
  KvStore,
  MissionClient,
  PanelApi,
  Param,
  ParamClient,
  Permission,
  VehicleState,
} from '../../src/contracts';
import { createExtensionSystem, createEventsBus, type ExtApiServices } from '../../src/ext/api';
import type { ConfirmFn } from '../../src/ext/permissions';
import type { ExtModule } from '../../src/ext/host';
import { examples } from '../../extensions/index.js';

interface ExampleModule extends ExtModule {
  manifest: ExtManifest;
}

interface ServiceHarness {
  services: ExtApiServices;
  panels: Parameters<ExtApiServices['ui']['registerPanel']>[0][];
  commands: Parameters<ExtApiServices['ui']['registerCommand']>[0][];
  layers: Parameters<NonNullable<ExtApiServices['map']>['addLayer']>[0][];
  themes: unknown[];
  transports: Parameters<NonNullable<ExtApiServices['transports']>['register']>[0][];
  disposals: string[];
  emitMavlink(name: string, fields: Record<string, FieldValue>): void;
}

function fakeKv(): KvStore {
  const store = new Map<string, unknown>();
  const key = (ns: string, k: string): string => `${ns}\u0000${k}`;
  return {
    get<T>(ns: string, k: string): Promise<T | undefined> {
      return Promise.resolve(store.get(key(ns, k)) as T | undefined);
    },
    set<T>(ns: string, k: string, value: T): Promise<void> {
      store.set(key(ns, k), value);
      return Promise.resolve();
    },
    del(ns: string, k: string): Promise<void> {
      store.delete(key(ns, k));
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
  position: { lat: 47.397742, lon: 8.545594, altRelM: 12, altAmslM: 500 },
  battery: { voltageV: 11.1, currentA: 3.2, remainingPct: 55 },
  link: { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false },
  lastHeartbeatMs: 0,
};

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

function fakeParamClient(disposals: string[]): ParamClient {
  const values = new Map<string, Param>([
    ['PSC_POSXY_P', { name: 'PSC_POSXY_P', value: 0.8, type: 9 }],
    ['PSC_VELXY_P', { name: 'PSC_VELXY_P', value: 1.5, type: 9 }],
  ]);
  return {
    fetchAll: vi.fn<ParamClient['fetchAll']>(() => Promise.resolve([...values.values()])),
    get: vi.fn<ParamClient['get']>((name) => values.get(name)),
    set: vi.fn<ParamClient['set']>((name, value) => {
      values.set(name, { name, value, type: 9 });
      return Promise.resolve();
    }),
    onChange: vi.fn<ParamClient['onChange']>(() => () => {
      disposals.push('params.onChange');
    }),
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

function decoded(name: string, fields: Record<string, FieldValue>): DecodedMessage {
  return {
    sysid: 1,
    compid: 1,
    seq: 1,
    msgId: 1,
    name,
    fields,
    crcOk: true,
    signed: false,
    rxTimeUs: 123_000,
    raw: new Uint8Array(),
  };
}

function fakeServices(): ServiceHarness {
  const handlers = new Map<string, Set<(message: DecodedMessage) => void>>();
  const panels: ServiceHarness['panels'] = [];
  const commands: ServiceHarness['commands'] = [];
  const layers: ServiceHarness['layers'] = [];
  const themes: unknown[] = [];
  const transports: ServiceHarness['transports'] = [];
  const disposals: string[] = [];
  const services: ExtApiServices = {
    connection: { state: () => ({ kind: 'open' }), on: () => () => disposals.push('connection') },
    vehicles: {
      list: () => [vehicleStub],
      active: () => vehicleStub,
      on: () => () => disposals.push('vehicles'),
    },
    mavlink: {
      on: (name, cb) => {
        const set = handlers.get(name) ?? new Set<(message: DecodedMessage) => void>();
        set.add(cb);
        handlers.set(name, set);
        return () => {
          set.delete(cb);
          disposals.push(`mavlink:${name}`);
        };
      },
      latest: () => undefined,
      rate: () => 1,
      requestInterval: vi.fn<(name: string, hz: number) => void>(),
      send: vi.fn<(name: string, fields: Record<string, unknown>) => void>(),
      loadDialect: vi.fn<(src: string) => void>(),
    },
    command: fakeCommandClient(),
    params: fakeParamClient(disposals),
    mission: fakeMissionClient(),
    ui: {
      registerPanel: vi.fn<ExtApiServices['ui']['registerPanel']>((panel) => {
        panels.push(panel);
        return () => disposals.push(`panel:${panel.id}`);
      }),
      registerCommand: vi.fn<ExtApiServices['ui']['registerCommand']>((command) => {
        commands.push(command);
        return () => disposals.push(`command:${command.id}`);
      }),
      addMenuItem: vi.fn<ExtApiServices['ui']['addMenuItem']>(() => () => disposals.push('menu')),
      registerWidget: vi.fn<ExtApiServices['ui']['registerWidget']>(
        () => () => disposals.push('widget'),
      ),
      toast: vi.fn<ExtApiServices['ui']['toast']>(),
      confirm: vi.fn<ExtApiServices['ui']['confirm']>(() => Promise.resolve(true)),
      h: (tag: string, props?: unknown, ...kids: unknown[]): unknown => ({ tag, props, kids }),
    },
    notify: {
      info: vi.fn<(message: string) => void>(),
      warn: vi.fn<(message: string) => void>(),
      error: vi.fn<(message: string) => void>(),
    },
    map: {
      addLayer: vi.fn<NonNullable<ExtApiServices['map']>['addLayer']>((layer) => {
        layers.push(layer);
        return () => disposals.push(`layer:${layer.id}`);
      }),
      on: vi.fn<NonNullable<ExtApiServices['map']>['on']>(() => () => disposals.push('map.on')),
      setBasemap: vi.fn<NonNullable<ExtApiServices['map']>['setBasemap']>(),
      prefetch: vi.fn<NonNullable<ExtApiServices['map']>['prefetch']>(() => Promise.resolve()),
    },
    theme: {
      register: vi.fn<NonNullable<ExtApiServices['theme']>['register']>((tokens) => {
        themes.push(tokens);
        return () => disposals.push('theme');
      }),
    },
    logs: { openCurrentTlog: () => 'tlog', queryDataFlash: () => Promise.resolve([]) },
    files: { openForRead: () => Promise.resolve(new Blob(['x'])), saveAs: () => Promise.resolve() },
    net: { fetch: () => Promise.resolve(new Response('ok')) },
    transports: {
      register: vi.fn<NonNullable<ExtApiServices['transports']>['register']>((factory) => {
        transports.push(factory);
        return () => disposals.push(`transport:${factory.id}`);
      }),
    },
  };
  return {
    services,
    panels,
    commands,
    layers,
    themes,
    transports,
    disposals,
    emitMavlink(name, fields) {
      const set = handlers.get(name);
      if (!set) return;
      for (const cb of set) cb(decoded(name, fields));
    },
  };
}

const exampleModules = examples as readonly ExampleModule[];

async function activateExample(example: ExampleModule, harness = fakeServices()) {
  const storage = fakeKv();
  const events = createEventsBus();
  const system = createExtensionSystem({
    storage,
    services: harness.services,
    confirm: vi.fn<ConfirmFn>(() => Promise.resolve(true)),
    events,
    now: () => 10,
  });
  await system.install({ manifest: example.manifest, module: example });
  await system.setGrants(example.manifest.id, example.manifest.permissions as Permission[]);
  const state = await system.activate(example.manifest.id);
  return { system, harness, events, state };
}

describe('first-party example extensions', () => {
  it('exports exactly the seven T7.6 examples with documented minimal permissions', () => {
    expect(exampleModules.map((example) => example.manifest.id)).toEqual([
      'org.mvplanner.examples.battery-plus',
      'org.mvplanner.examples.geo-tagger',
      'org.mvplanner.examples.param-diff-presets',
      'org.mvplanner.examples.custom-nmea-adsb-layer',
      'org.mvplanner.examples.auto-test-script-pack',
      'org.mvplanner.examples.theme-pack',
      'org.mvplanner.examples.custom-transport-demo',
    ]);
    expect(exampleModules.map((example) => example.manifest.permissions)).toEqual([
      ['telemetry:read', 'ui:panel', 'notify'],
      ['telemetry:read', 'storage'],
      ['telemetry:read', 'params:write', 'ui:panel'],
      ['map', 'telemetry:read'],
      ['command', 'telemetry:read'],
      ['ui:panel'],
      ['transport'],
    ]);
  });

  it('loads and activates each example with only its declared grants', async () => {
    for (const example of exampleModules) {
      const { state, system } = await activateExample(example);
      expect(state.status).toBe('active');
      expect(state.manifest.contributes).toBeDefined();
      await system.disable(example.manifest.id);
      system.dispose();
    }
  });

  it('registers runtime implementations for declared panels, commands, layers, themes, and transports', async () => {
    for (const example of exampleModules) {
      const { system, harness } = await activateExample(example);
      const contributes = example.manifest.contributes ?? {};
      const panelIds = harness.panels.map((panel) => panel.id);
      const commandIds = harness.commands.map((command) => command.id);
      const layerIds = harness.layers.map((layer) => layer.id);
      const transportIds = harness.transports.map((transport) => transport.id);
      expect(panelIds).toEqual((contributes.panels ?? []).map((panel) => panel.id));
      expect(commandIds).toEqual((contributes.commands ?? []).map((command) => command.id));
      expect(layerIds).toEqual(
        (contributes.mapLayers ?? []).map((layer) => String((layer as { id: unknown }).id)),
      );
      if (contributes.themes) expect(harness.themes).toHaveLength(contributes.themes.length);
      if (contributes.transports)
        expect(transportIds).toEqual(
          contributes.transports.map((transport) => String((transport as { id: unknown }).id)),
        );
      await system.disable(example.manifest.id);
      system.dispose();
    }
  });

  it('updates the Battery+ panel on SYS_STATUS and tears down the telemetry handler', async () => {
    const battery = exampleModules.find((example) => example.manifest.id.endsWith('battery-plus'));
    expect(battery).toBeDefined();
    const { system, harness } = await activateExample(battery as ExampleModule);
    const panel = harness.panels.find((registered) => registered.id === 'battery-plus');
    expect(panel).toBeDefined();
    const el = document.createElement('section');
    panel?.mount(el, {
      store: { get: () => ({}), select: () => () => ({}), patch: () => undefined },
      t: (key: string) => key,
    } as unknown as PanelApi);
    harness.emitMavlink('SYS_STATUS', {
      voltage_battery: 10_200,
      current_battery: 321,
      current_consumed: 1500,
      battery_remaining: 18,
    });
    expect(el.textContent).toContain('10.20 V');
    expect(el.textContent).toContain('3.2 A');
    expect(el.textContent).toContain('15.3 Wh');
    expect(harness.services.notify.warn).toHaveBeenCalledWith(
      expect.stringContaining('Low battery'),
    );
    await system.disable(battery?.manifest.id ?? 'missing');
    expect(harness.disposals).toContain('mavlink:SYS_STATUS');
    system.dispose();
  });

  it('geo-tags camera triggers into extension-scoped storage', async () => {
    const geo = exampleModules.find((example) => example.manifest.id.endsWith('geo-tagger'));
    expect(geo).toBeDefined();
    const { system, harness } = await activateExample(geo as ExampleModule);
    harness.emitMavlink('CAMERA_TRIGGER', { seq: 7 });
    await vi.waitFor(async () => {
      const tags = await system.host
        .extStorage(geo?.manifest.id ?? 'missing')
        .get<unknown[]>('camera-tags');
      expect(tags).toEqual([
        expect.objectContaining({
          seq: 7,
          lat: vehicleStub.position?.lat,
          lon: vehicleStub.position?.lon,
        }),
      ]);
    });
    await system.disable(geo?.manifest.id ?? 'missing');
    system.dispose();
  });

  it('runs the safe auto-test sequence only when triggered and unregisters on disable', async () => {
    const autoTest = exampleModules.find((example) =>
      example.manifest.id.endsWith('auto-test-script-pack'),
    );
    expect(autoTest).toBeDefined();
    const { system, harness, events } = await activateExample(autoTest as ExampleModule);
    expect(harness.services.command.setMode).not.toHaveBeenCalled();
    events.emit('mvplanner.examples.autotest.run', undefined);
    await vi.waitFor(() => {
      expect(harness.services.command.setMode).toHaveBeenCalledWith(vehicleStub.mode);
    });
    await system.disable(autoTest?.manifest.id ?? 'missing');
    events.emit('mvplanner.examples.autotest.run', undefined);
    await Promise.resolve();
    expect(harness.services.command.setMode).toHaveBeenCalledTimes(1);
    system.dispose();
  });

  it('registers and disposes the custom echo transport factory', async () => {
    const transport = exampleModules.find((example) =>
      example.manifest.id.endsWith('custom-transport-demo'),
    );
    expect(transport).toBeDefined();
    const { system, harness } = await activateExample(transport as ExampleModule);
    expect(harness.transports).toHaveLength(1);
    expect(harness.transports[0]?.id).toBe('examples.echo');
    expect(harness.transports[0]?.create().stats()).toEqual({
      bytesIn: 0,
      bytesOut: 0,
      packetsIn: 0,
      lossPct: 0,
      rateHz: 0,
      signed: false,
    });
    await system.disable(transport?.manifest.id ?? 'missing');
    expect(harness.disposals).toContain('transport:examples.echo');
    system.dispose();
  });
});
