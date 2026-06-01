/**
 * Flight Data screen assembly tests (task T2.11; spec plan/04 §4.2, plan/05
 * §5.4 Flight). Renders {@link FlightScreen} over mock app/connection-scoped
 * services + an offline map engine seam and asserts the composed layout, live
 * store→widget propagation, the STATUSTEXT console, the actions→command→audit
 * path and the tlog record toggle. A shell-integration case asserts navigating
 * to Flight mounts the real screen over the placeholder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type {
  AppState,
  BlobStore,
  CommandClient,
  FileIo,
  MissionClient,
  Param,
  ParamClient,
  Store,
  VehicleState,
} from '../../src/contracts';
import type { ElevationProvider } from '../../src/geo/terrain';
import { createParamMetaStore } from '../../src/mavlink/param-meta';
import type { Preset, PresetStore } from '../../src/data/paramfile';
import type { Capabilities } from '../../src/core/capabilities';
import { createAppStore } from '../../src/core/store';
import { createAuditLog, type AuditLog } from '../../src/core/audit';
import { TlogRecorder } from '../../src/data/tlog';
import { createRasterMapEngine, type RasterMapEngine } from '../../src/ui/widgets/map';
import type { TileCache } from '../../src/geo/tiles';
import type { StatusMessage } from '../../src/ui/widgets/messages';
import type { QuickWatchSource } from '../../src/ui/widgets/quickwatch';
import {
  FlightScreen,
  createFlightScreenPanel,
  type FlightServices,
} from '../../src/ui/screens/flight';
import {
  Shell,
  createUiRegistry,
  setScreenPanel,
  type ShellContextValue,
} from '../../src/ui/shell';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// --------------------------------------------------------------------------
// Mocks / harness
// --------------------------------------------------------------------------

interface Call {
  method: string;
  args: readonly unknown[];
}

function mockCommand(): { client: CommandClient; calls: Call[] } {
  const calls: Call[] = [];
  const rec =
    (method: string) =>
    (...args: unknown[]): Promise<void> => {
      calls.push({ method, args });
      return Promise.resolve();
    };
  const client: CommandClient = {
    send: (cmd, params, opts) => {
      calls.push({ method: 'send', args: [cmd, params, opts] });
      return Promise.resolve({ result: 0 });
    },
    arm: rec('arm'),
    setMode: rec('setMode'),
    takeoff: rec('takeoff'),
    land: rec('land'),
    rtl: rec('rtl'),
    guidedGoto: rec('guidedGoto'),
    setRoi: rec('setRoi'),
    clearRoi: rec('clearRoi'),
    setCurrentWp: rec('setCurrentWp'),
  };
  return { client, calls };
}

/** Inert ParamClient stub (the Flight screen does not exercise params). */
function stubParamClient(): ParamClient {
  return {
    fetchAll: (): Promise<Param[]> => Promise.resolve([]),
    get: (): Param | undefined => undefined,
    set: (): Promise<void> => Promise.resolve(),
    onChange: (): (() => void) => () => undefined,
  };
}

/** Inert MissionClient stub (the Plan screen exercises a richer one). */
function stubMissionClient(): MissionClient {
  return {
    download: () => Promise.resolve({ type: 'mission', items: [] }),
    upload: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    setCurrent: () => Promise.resolve(),
    onCurrent: () => () => undefined,
    onReached: () => () => undefined,
  };
}

/** Inert ElevationProvider stub (no terrain sampling in Flight tests). */
function stubElevationProvider(): ElevationProvider {
  return {
    sampleElevation: () => Promise.resolve(undefined),
    pathProfile: () => Promise.resolve([]),
    source: { id: 'stub', kind: 'xyz', url: '' },
    zoom: 12,
  };
}

/** Inert PresetStore stub. */
function stubPresetStore(): PresetStore {
  return {
    list: (): Promise<Preset[]> => Promise.resolve([]),
    get: (): Promise<Preset | undefined> => Promise.resolve(undefined),
    save: (): Promise<void> => Promise.resolve(),
    remove: (): Promise<void> => Promise.resolve(),
  };
}

function fakeBlobs(): BlobStore {
  return {
    put: async () => undefined,
    getRange: async () => new Uint8Array(0),
    size: async () => 0,
    list: async () => [],
    del: async () => undefined,
  };
}

function fakeFiles(saved: { calls: number }): FileIo {
  return {
    openForRead: async () => undefined,
    saveAs: async () => {
      saved.calls += 1;
    },
  };
}

function emptyWatchSource(): QuickWatchSource {
  return {
    listFields: () => [],
    sample: () => undefined,
    subscribe: () => () => undefined,
  };
}

function fakeCache(): TileCache {
  return {
    get: async () => undefined,
    getCached: async () => undefined,
    put: async () => undefined,
    has: async () => false,
    prefetch: async (_s, tiles) => ({
      requested: tiles.length,
      fetched: 0,
      cached: 0,
      failed: 0,
    }),
    evict: async () => 0,
    clear: async () => undefined,
  };
}

/** An offline raster engine (immediate frames, no network, no canvas pixels). */
function offlineEngine(): RasterMapEngine {
  return createRasterMapEngine({
    cache: fakeCache(),
    isOnline: () => false,
    requestFrame: (cb) => {
      cb();
      return 0;
    },
    cancelFrame: () => undefined,
  });
}

interface Harness {
  services: FlightServices;
  store: Store<AppState>;
  command: { client: CommandClient; calls: Call[] };
  audit: AuditLog;
  recorder: TlogRecorder;
  setStatus: (msgs: readonly StatusMessage[]) => void;
  saved: { calls: number };
}

function makeHarness(): Harness {
  const command = mockCommand();
  const audit = createAuditLog();
  const saved = { calls: 0 };
  const recorder = new TlogRecorder({
    source: { onRawFrame: () => () => undefined },
    blobs: fakeBlobs(),
    fileIo: fakeFiles(saved),
  });
  const [statusMessages, setStatus] = createSignal<readonly StatusMessage[]>([]);
  const services: FlightServices = {
    command: command.client,
    mission: stubMissionClient(),
    param: stubParamClient(),
    paramMeta: createParamMetaStore(),
    presetStore: stubPresetStore(),
    audit,
    recorder,
    statusMessages,
    blobs: fakeBlobs(),
    files: fakeFiles(saved),
    terrainProvider: stubElevationProvider(),
    quickWatchSource: emptyWatchSource(),
  };
  return {
    services,
    store: createAppStore(),
    command,
    audit,
    recorder,
    setStatus,
    saved,
  };
}

function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
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
    ...overrides,
  };
}

function mount(h: Harness): HTMLElement {
  const { container } = render(() =>
    createComponent(FlightScreen, {
      services: h.services,
      store: h.store,
      confirm: () => Promise.resolve(true),
      t,
      createEngine: () => offlineEngine(),
    }),
  );
  return container;
}

afterEach(() => {
  cleanup();
  setScreenPanel('flight', undefined);
});

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('FlightScreen — composition', () => {
  it('renders the composed layout (HUD, map, gauges, actions, status, quick-watch)', async () => {
    const h = makeHarness();
    const c = mount(h);
    await settle();

    expect(c.querySelector('.mvp-flight')).toBeTruthy();
    expect(c.querySelector('.mvp-hud')).toBeTruthy();
    expect(c.querySelector('.mvp-map')).toBeTruthy();
    expect(c.querySelector('.mvp-gauges')).toBeTruthy();
    expect(c.querySelector('.mvp-actions')).toBeTruthy();
    expect(c.querySelector('.mvp-messages')).toBeTruthy();
    expect(c.querySelector('.mvp-quickwatch')).toBeTruthy();
    // The map click-intent + guided-mode toggles are wired into the toolbar.
    expect(c.querySelector('[data-testid="flight-tool"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="flight-guided"]')).toBeTruthy();
  });
});

describe('FlightScreen — live store propagation', () => {
  it('propagates a store vehicle update to the HUD summary and gauges', async () => {
    const h = makeHarness();
    const c = mount(h);
    await settle();

    h.store.patch((s) => {
      s.vehicles[1] = makeVehicle({
        armed: true,
        mode: 'AUTO',
        throttlePct: 42,
        position: { lat: 1, lon: 2, altRelM: 12, altAmslM: 112 },
        rcIn: [1500, 1490],
        rcOut: [1600],
      });
      s.activeSysid = 1;
    });
    await settle();

    // HUD a11y summary mirrors the live mode + armed state.
    const hudA11y = c.querySelector('.mvp-hud__a11y')?.textContent ?? '';
    expect(hudA11y).toContain('AUTO');
    expect(hudA11y).toContain(t('hud.armed'));

    // The RC gauge consumes the new rcIn/rcOut fields (locale-formatted µs).
    expect(c.textContent).toContain('1,500');
    expect(c.textContent).toContain('1,600');
  });
});

describe('FlightScreen — STATUSTEXT console', () => {
  it('shows a STATUSTEXT pushed through the accumulator', async () => {
    const h = makeHarness();
    const c = mount(h);
    await settle();

    expect(c.querySelector('.mvp-messages__row')).toBeNull();
    h.setStatus([
      { severity: 4, text: 'Pre-arm: check battery', sysid: 1, compid: 1, tMs: Date.now(), seq: 0 },
    ]);
    await settle();

    expect(c.querySelector('.mvp-messages__text')?.textContent).toBe('Pre-arm: check battery');
  });
});

describe('FlightScreen — actions → command → audit', () => {
  it('arming routes through confirm, the command client and the shared audit log', async () => {
    const h = makeHarness();
    const confirm = vi.fn(() => Promise.resolve(true));
    const { container } = render(() =>
      createComponent(FlightScreen, {
        services: h.services,
        store: h.store,
        confirm,
        t,
        createEngine: () => offlineEngine(),
      }),
    );
    h.store.patch((s) => {
      s.vehicles[1] = makeVehicle({ armed: false });
      s.activeSysid = 1;
    });
    await settle();

    const armBtn = container.querySelector('[data-action="arm"]') as HTMLButtonElement;
    expect(armBtn.disabled).toBe(false);
    armBtn.click();
    await settle();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(h.command.calls).toEqual([{ method: 'arm', args: [true] }]);
    expect(h.audit.list().at(-1)?.status).toBe('ok');
  });
});

describe('FlightScreen — tlog record control', () => {
  it('toggles the app-scoped recorder on/off', async () => {
    const h = makeHarness();
    const c = mount(h);
    await settle();

    const recBtn = c.querySelector('[data-testid="flight-record"]') as HTMLButtonElement;
    expect(h.recorder.isRecording).toBe(false);

    recBtn.click();
    await settle();
    expect(h.recorder.isRecording).toBe(true);

    recBtn.click();
    await settle();
    expect(h.recorder.isRecording).toBe(false);
  });

  it('exports via the recorder saveAs (storage.files) path', async () => {
    const h = makeHarness();
    const c = mount(h);
    await settle();

    (c.querySelector('[data-testid="flight-export"]') as HTMLButtonElement).click();
    await settle();
    expect(h.saved.calls).toBe(1);
  });
});

// --------------------------------------------------------------------------
// Shell integration: navigating to Flight mounts the real screen
// --------------------------------------------------------------------------

function makeCaps(): Capabilities {
  return {
    webSerial: true,
    webBluetooth: false,
    webUsb: false,
    fileSystemAccess: false,
    wasm: true,
    secureContext: true,
    offscreenCanvas: false,
    crossOriginIsolated: false,
    webSpeech: false,
    gamepad: false,
  };
}

describe('FlightScreen — shell registration', () => {
  it('replaces the Flight placeholder so the dock mounts the real screen', async () => {
    const h = makeHarness();
    const store = h.store;
    const registry = createUiRegistry();

    setScreenPanel('flight', createFlightScreenPanel({ services: h.services, store, registry, t }));

    const ctx: ShellContextValue = {
      store,
      registry,
      capabilities: makeCaps(),
      panelApi: { store, t },
    };
    const { container } = render(() => createComponent(Shell, { ctx }));
    await settle();

    // Default active screen is `flight`; the real composed screen is mounted,
    // not the placeholder hint.
    expect(container.querySelector('.mvp-flight')).toBeTruthy();
    expect(container.querySelector('.mvp-hud')).toBeTruthy();
    expect(container.querySelector('.mvp-screen__hint')).toBeNull();
  });
});
