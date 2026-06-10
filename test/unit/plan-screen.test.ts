/**
 * Flight Plan screen assembly tests (task T4.10; spec plan/04 §4.3, plan/05
 * §5.4 Plan). Renders {@link PlanScreen} over a mock {@link MissionClient} + an
 * offline map engine seam and asserts the composed layout (map, waypoint table,
 * tool rail, terrain profile, transfer toolbar), tool switching, the
 * upload-mission path (calls `MissionClient.upload` with the wire mission), and
 * that a table edit and a map-click edit share the one mission signal. A
 * shell-integration case asserts navigating to Plan mounts the real screen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type {
  AppState,
  BasemapSource,
  BlobStore,
  FileIo,
  KvStore,
  Mission,
  MissionClient,
  Param,
  ParamClient,
  Store,
  VehicleState,
} from '../../src/contracts';
import { createRecentsStore } from '../../src/core/recents';
import type { ElevationProvider } from '../../src/geo/terrain';
import { createAppStore } from '../../src/core/store';
import {
  BASEMAP_PRESETS,
  createRasterMapEngine,
  type RasterMapEngine,
} from '../../src/ui/widgets/map';
import { TrafficStore } from '../../src/ui/widgets/map/layers/adsb';
import type { TileCache } from '../../src/geo/tiles';
import type { StatusMessage } from '../../src/ui/widgets/messages';
import type { QuickWatchSource } from '../../src/ui/widgets/quickwatch';
import type { AuditLog } from '../../src/core/audit';
import { createAuditLog } from '../../src/core/audit';
import { createParamMetaStore } from '../../src/mavlink/param-meta';
import type { Preset, PresetStore } from '../../src/data/paramfile';
import { TlogRecorder } from '../../src/data/tlog';
import type { Capabilities } from '../../src/core/capabilities';
import {
  PlanScreen,
  createPlanScreenPanel,
  createPlanSession,
  type TFn,
} from '../../src/ui/screens/plan';
import type { FlightServices } from '../../src/ui/screens/flight';
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

interface MissionSpy {
  readonly client: MissionClient;
  readonly uploads: Mission[];
  download: Mission;
}

function mockMission(): MissionSpy {
  const spy: MissionSpy = {
    uploads: [],
    download: { type: 'mission', items: [] },
    client: {
      upload: vi.fn<MissionClient['upload']>((m: Mission) => {
        spy.uploads.push(m);
        return Promise.resolve();
      }),
      download: vi.fn<MissionClient['download']>(() => Promise.resolve(spy.download)),
      clear: () => Promise.resolve(),
      setCurrent: () => Promise.resolve(),
      onCurrent: () => () => undefined,
      onReached: () => () => undefined,
    },
  };
  return spy;
}

function stubParamClient(): ParamClient {
  return {
    fetchAll: (): Promise<Param[]> => Promise.resolve([]),
    get: (): Param | undefined => undefined,
    set: (): Promise<void> => Promise.resolve(),
    onChange: (): (() => void) => () => undefined,
  };
}

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

function fakeFiles(): FileIo {
  return { openForRead: async () => undefined, saveAs: async () => undefined };
}

/** In-memory KV fake for the recents store. */
function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    get: async <T>(ns: string, key: string): Promise<T | undefined> =>
      map.get(`${ns}/${key}`) as T | undefined,
    set: async <T>(ns: string, key: string, v: T): Promise<void> => {
      map.set(`${ns}/${key}`, v);
    },
    del: async (ns: string, key: string): Promise<void> => {
      map.delete(`${ns}/${key}`);
    },
  };
}

/** In-memory blob store fake for the recents store (round-trippable). */
function inMemoryBlobs(): BlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    put: async (ns, key, data): Promise<void> => {
      map.set(`${ns}/${key}`, new Uint8Array(await data.arrayBuffer()));
    },
    getRange: async (ns, key, start, end): Promise<Uint8Array> => {
      const d = map.get(`${ns}/${key}`);
      if (d === undefined) throw new Error('missing');
      return d.slice(start, end);
    },
    size: async (ns, key): Promise<number> => map.get(`${ns}/${key}`)?.byteLength ?? 0,
    list: async (): Promise<never[]> => [],
    del: async (ns, key): Promise<void> => {
      map.delete(`${ns}/${key}`);
    },
  };
}

function stubElevationProvider(): ElevationProvider {
  return {
    sampleElevation: () => Promise.resolve(undefined),
    pathProfile: () => Promise.resolve([]),
    source: { id: 'stub', kind: 'xyz', url: '' },
    zoom: 12,
  };
}

function emptyWatchSource(): QuickWatchSource {
  return { listFields: () => [], sample: () => undefined, subscribe: () => () => undefined };
}

function fakeCache(): TileCache {
  return {
    get: async () => undefined,
    getCached: async () => undefined,
    put: async () => undefined,
    has: async () => false,
    prefetch: async (_s, tiles) => ({ requested: tiles.length, fetched: 0, cached: 0, failed: 0 }),
    evict: async () => 0,
    clear: async () => undefined,
  };
}

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
  mission: MissionSpy;
}

function makeServices(mission: MissionSpy): FlightServices {
  const [statusMessages] = createSignal<readonly StatusMessage[]>([]);
  const audit: AuditLog = createAuditLog();
  const recorder = new TlogRecorder({
    source: { onRawFrame: () => () => undefined },
    blobs: fakeBlobs(),
    fileIo: fakeFiles(),
  });
  return {
    command: {} as FlightServices['command'],
    calibration: {} as FlightServices['calibration'],
    mission: mission.client,
    param: stubParamClient(),
    paramMeta: createParamMetaStore(),
    presetStore: stubPresetStore(),
    audit,
    recorder,
    statusMessages,
    blobs: fakeBlobs(),
    files: fakeFiles(),
    terrainProvider: stubElevationProvider(),
    quickWatchSource: emptyWatchSource(),
    traffic: new TrafficStore(),
  };
}

function makeHarness(): Harness {
  const mission = mockMission();
  return { services: makeServices(mission), mission };
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

function mount(h: Harness, engine?: RasterMapEngine): HTMLElement {
  const eng = engine ?? offlineEngine();
  const { container } = render(() =>
    createComponent(PlanScreen, { services: h.services, t, createEngine: () => eng }),
  );
  return container;
}

afterEach(() => {
  cleanup();
  setScreenPanel('plan', undefined);
});

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('PlanScreen — composition', () => {
  it('renders the map, waypoint table, tool rail, terrain profile and toolbar', async () => {
    const c = mount(makeHarness());
    await settle();
    expect(c.querySelector('.mvp-plan')).toBeTruthy();
    expect(c.querySelector('.mvp-map')).toBeTruthy();
    expect(c.querySelector('.mvp-wptable')).toBeTruthy();
    expect(c.querySelector('.mvp-plan__rail')).toBeTruthy();
    expect(c.querySelector('.mvp-terrain')).toBeTruthy();
    expect(c.querySelector('[data-testid="plan-upload-mission"]')).toBeTruthy();
    // Tool rail offers add-waypoint, survey, fence, rally, measure + import.
    expect(c.querySelector('[data-testid="plan-tool-add-waypoint"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="plan-tool-import"]')).toBeTruthy();
  });

  it('switches the active tool and updates the hint', async () => {
    const c = mount(makeHarness());
    await settle();
    const addBtn = c.querySelector('[data-testid="plan-tool-add-waypoint"]') as HTMLButtonElement;
    fireEvent.click(addBtn);
    expect(addBtn.getAttribute('aria-pressed')).toBe('true');
    expect(c.querySelector('[data-testid="plan-hint"]')?.textContent).toBe(
      t('plan.tool.hint.addWaypoint'),
    );
  });
});

describe('PlanScreen — upload toolbar', () => {
  it('uploads the wire mission via MissionClient.upload', async () => {
    const h = makeHarness();
    const c = mount(h);
    await settle();

    // Add a waypoint through the table (writes the shared mission signal).
    fireEvent.click(c.querySelector('[data-testid="wp-add"]') as HTMLButtonElement);
    fireEvent.click(c.querySelector('[data-testid="plan-upload-mission"]') as HTMLButtonElement);
    await settle();

    expect(h.mission.client.upload).toHaveBeenCalledTimes(1);
    const sent = h.mission.uploads[0];
    expect(sent?.type).toBe('mission');
    expect(sent?.items).toHaveLength(1);
    // The verify toggle is on by default → passed through to the client.
    const opts = (h.mission.client.upload as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as
      | { verify?: boolean }
      | undefined;
    expect(opts?.verify).toBe(true);
  });

  it('downloads a mission and populates the table', async () => {
    const h = makeHarness();
    h.mission.download = {
      type: 'mission',
      items: [
        {
          seq: 0,
          frame: 3,
          command: 16,
          current: 1,
          autocontinue: 1,
          params: [0, 0, 0, 0],
          x: 100000000,
          y: 200000000,
          z: 50,
        },
      ],
    };
    const c = mount(h);
    await settle();
    fireEvent.click(c.querySelector('[data-testid="plan-download-mission"]') as HTMLButtonElement);
    await settle();
    expect(h.mission.client.download).toHaveBeenCalled();
    expect(c.querySelector('[data-testid="wp-total-waypoints"]')?.textContent).toContain('1');
  });
});

describe('PlanScreen — map ⇄ table sync via the shared signal', () => {
  it('a map click in add-waypoint mode appends a row to the table', async () => {
    const engine = offlineEngine();
    const c = mount(makeHarness(), engine);
    await settle();

    // Switch to add-waypoint, then synthesise a map click through the engine.
    fireEvent.click(c.querySelector('[data-testid="plan-tool-add-waypoint"]') as HTMLButtonElement);
    engine.clickAt(10, 10);
    await settle();

    // The shared mission signal now drives the table: a row exists.
    expect(c.querySelector('[data-seq="0"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="wp-empty"]')).toBeNull();
  });
});

describe('PlanScreen — session persistence', () => {
  it('keeps the plan when the screen is unmounted + remounted (tab switch)', async () => {
    const session = createPlanSession();
    const h = makeHarness();
    const engine1 = offlineEngine();
    engine1.setView({ lat: -35.36, lon: 149.16, zoom: 18 });
    const first = render(() =>
      createComponent(PlanScreen, {
        services: h.services,
        t,
        createEngine: () => engine1,
        session,
      }),
    );
    await settle();
    // Draw a waypoint with the add-waypoint tool.
    fireEvent.click(
      first.container.querySelector('[data-testid="plan-tool-add-waypoint"]') as HTMLButtonElement,
    );
    engine1.clickAt(60, 60);
    await settle();
    expect(first.container.querySelector('[data-seq="0"]')).toBeTruthy();

    // Simulate a tab switch: the dock disposes the panel.
    cleanup();

    // Remount with the SAME session (fresh engine) — the plan must persist.
    const engine2 = offlineEngine();
    const second = render(() =>
      createComponent(PlanScreen, {
        services: h.services,
        t,
        createEngine: () => engine2,
        session,
      }),
    );
    await settle();
    expect(second.container.querySelector('[data-seq="0"]')).toBeTruthy();
    expect(second.container.querySelector('[data-testid="wp-empty"]')).toBeNull();
  });
});

describe('PlanScreen — map auto-centers on the vehicle', () => {
  it('centers the plan map on the active vehicle (not null island) when a store is supplied', async () => {
    const store = createAppStore();
    store.patch((s) => {
      s.vehicles[7] = makeVehicle({
        sysid: 7,
        position: { lat: -35.363, lon: 149.165, altRelM: 0, altAmslM: 0 },
      });
      s.activeSysid = 7;
    });
    const engine = offlineEngine();
    // The engine starts at the default null-island view (0,0).
    expect(engine.getView().lat).toBe(0);
    const h = makeHarness();
    render(() =>
      createComponent(PlanScreen, { services: h.services, t, createEngine: () => engine, store }),
    );
    await settle();
    // Auto-centered on the vehicle, so drawn surveys/fences are at its location.
    expect(engine.getView().lat).toBeCloseTo(-35.363, 2);
    expect(engine.getView().lon).toBeCloseTo(149.165, 2);
  });
});

describe('PlanScreen — map source → engine (spec §5.6/§7.4)', () => {
  it('applies settings.mapSource to the engine basemap when a store is supplied', async () => {
    const store = createAppStore();
    const sources: BasemapSource[] = [];
    const base = offlineEngine();
    const engine: RasterMapEngine = {
      ...base,
      setBasemap(next: BasemapSource): void {
        sources.push(next);
        base.setBasemap(next);
      },
    };
    const h = makeHarness();
    render(() =>
      createComponent(PlanScreen, { services: h.services, t, createEngine: () => engine, store }),
    );
    await settle();
    // The unset default resolves to the built-in CARTO-dark basemap.
    expect(sources.at(-1)?.id).toBe('carto-dark');

    const osm = BASEMAP_PRESETS.find((p) => p.id === 'osm');
    store.patch((s) => {
      s.settings.mapSource = { urlTemplate: osm?.url ?? '' };
    });
    await settle();
    expect(sources.at(-1)?.id).toBe('osm');
  });
});

describe('PlanScreen — recents recording + pending open (spec §5.1/§7.3)', () => {
  it('records a plan recent (with its blob) when saving a mission file', async () => {
    const recents = createRecentsStore({ kv: fakeKv(), blobs: inMemoryBlobs() });
    const h = makeHarness();
    const { container } = render(() =>
      createComponent(PlanScreen, {
        services: h.services,
        t,
        createEngine: () => offlineEngine(),
        recents,
      }),
    );
    await settle();

    fireEvent.click(container.querySelector('[data-testid="plan-save-plan"]') as HTMLButtonElement);
    await settle();

    expect(recents.snapshot()).toHaveLength(1);
    expect(recents.snapshot()[0]?.kind).toBe('plan');
    expect(recents.snapshot()[0]?.name).toBe('mission.plan');
  });

  it('loads a cached plan blob handed in via pendingOpen and clears it', async () => {
    const recents = createRecentsStore({ kv: fakeKv(), blobs: inMemoryBlobs() });
    // A minimal QGC WPL mission with one nav waypoint.
    const wpl = `QGC WPL 110\n0\t1\t0\t16\t0\t0\t0\t0\t-35.36\t149.16\t50\t1\n`;
    const entry = await recents.record({
      kind: 'plan',
      name: 'cached.waypoints',
      blob: new Blob([wpl]),
    });
    const loaded = await recents.open(entry.id);
    expect(loaded).toBeTruthy();

    const [pending, setPending] = createSignal<{ name: string; blob: Blob } | undefined>(loaded);
    let consumed = 0;
    const h = makeHarness();
    const { container } = render(() =>
      createComponent(PlanScreen, {
        services: h.services,
        t,
        createEngine: () => offlineEngine(),
        pendingOpen: () => pending(),
        onPendingConsumed: () => {
          consumed += 1;
          setPending(undefined);
        },
      }),
    );
    await settle();
    await settle();

    expect(consumed).toBe(1);
    // The cached mission was parsed into the shared signal → a table row exists.
    expect(container.querySelector('[data-seq="0"]')).toBeTruthy();
  });
});

describe('PlanScreen — survey generate wiring', () => {
  it('drawing a polygon enables Generate and applies the survey mission to the plan', async () => {
    // End-to-end: map editor polygon → live grid → Generate → onGenerate →
    // shared mission signal → waypoint table. (High zoom keeps the grid small.)
    const engine = offlineEngine();
    engine.setView({ lat: -35.36, lon: 149.16, zoom: 18 });
    const c = mount(makeHarness(), engine);
    await settle();
    engine.setView({ lat: -35.36, lon: 149.16, zoom: 18 });

    // Draw a 4-vertex polygon with the survey draw tool.
    fireEvent.click(
      c.querySelector('[data-testid="plan-tool-draw-survey-polygon"]') as HTMLButtonElement,
    );
    engine.clickAt(50, 50);
    engine.clickAt(200, 50);
    engine.clickAt(200, 200);
    engine.clickAt(50, 200);
    await settle();

    // Open the survey tab: the polygon reached the panel → Generate is enabled.
    fireEvent.click(c.querySelector('[data-testid="plan-tab-survey"]') as HTMLButtonElement);
    await settle();
    const generate = c.querySelector('[data-testid="survey-generate"]') as HTMLButtonElement;
    expect(generate.disabled).toBe(false);

    // Generate applies the survey mission to the shared signal → table rows.
    fireEvent.click(generate);
    await settle();
    expect(c.querySelector('[data-seq="0"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="wp-empty"]')).toBeNull();
  });
});

describe('PlanScreen — measure status visibility', () => {
  it('hides the measure prompt outside measure mode and shows it while measuring', async () => {
    const c = mount(makeHarness());
    await settle();
    const measure = c.querySelector('[data-testid="plan-measure"]') as HTMLElement;

    // Default tool is select → no lingering "Click the map to measure" prompt.
    expect(measure.textContent).toBe('');

    fireEvent.click(c.querySelector('[data-testid="plan-tool-measure"]') as HTMLButtonElement);
    expect(measure.textContent?.trim()).not.toBe('');

    // Switching back to a non-measure tool clears the live region again.
    fireEvent.click(c.querySelector('[data-testid="plan-tool-select"]') as HTMLButtonElement);
    expect(measure.textContent).toBe('');
  });
});

describe('PlanScreen — transfer busy lock (E7)', () => {
  it('disables all transfer buttons while an upload is in flight', async () => {
    const h = makeHarness();
    // Hanging upload: the promise never settles, so the busy lock stays on.
    h.services = {
      ...h.services,
      mission: {
        ...h.mission.client,
        upload: vi.fn<MissionClient['upload']>(() => new Promise<void>(() => undefined)),
      },
    };
    const c = mount(h);
    await settle();

    const btn = (id: string): HTMLButtonElement =>
      c.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement;
    expect(btn('plan-upload-mission').disabled).toBe(false);
    fireEvent.click(btn('plan-upload-mission'));
    await settle();

    expect(btn('plan-upload-mission').disabled).toBe(true);
    expect(btn('plan-download-mission').disabled).toBe(true);
    expect(btn('plan-upload-fence').disabled).toBe(true);
    expect(btn('plan-upload-rally').disabled).toBe(true);
  });

  it('short-circuits with “Not connected” when the store link is not open', async () => {
    const store = createAppStore();
    const h = makeHarness();
    const { container } = render(() =>
      createComponent(PlanScreen, {
        services: h.services,
        t,
        createEngine: () => offlineEngine(),
        store,
      }),
    );
    await settle();
    fireEvent.click(
      container.querySelector('[data-testid="plan-upload-mission"]') as HTMLButtonElement,
    );
    await settle();
    expect(h.mission.client.upload).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="plan-status"]')?.textContent).toBe(
      t('plan.status.notConnected'),
    );
  });
});

describe('PlanScreen — destructive-replace confirm (E8)', () => {
  it('asks before survey-generate replaces a non-empty mission and aborts when declined', async () => {
    const session = createPlanSession();
    const confirm = vi.fn(() => Promise.resolve(false));
    const engine = offlineEngine();
    engine.setView({ lat: -35.36, lon: 149.16, zoom: 18 });
    const h = makeHarness();
    const { container } = render(() =>
      createComponent(PlanScreen, {
        services: h.services,
        t,
        createEngine: () => engine,
        session,
        confirm,
      }),
    );
    await settle();
    engine.setView({ lat: -35.36, lon: 149.16, zoom: 18 });

    // Seed a non-empty mission via the table, then draw a survey polygon.
    fireEvent.click(container.querySelector('[data-testid="wp-add"]') as HTMLButtonElement);
    fireEvent.click(
      container.querySelector('[data-testid="plan-tool-draw-survey-polygon"]') as HTMLButtonElement,
    );
    engine.clickAt(50, 50);
    engine.clickAt(200, 50);
    engine.clickAt(200, 200);
    engine.clickAt(50, 200);
    await settle();

    fireEvent.click(
      container.querySelector('[data-testid="plan-tab-survey"]') as HTMLButtonElement,
    );
    await settle();
    fireEvent.click(
      container.querySelector('[data-testid="survey-generate"]') as HTMLButtonElement,
    );
    await settle();

    // The confirm seam was consulted, and the decline left the mission intact.
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(session.mission().items).toHaveLength(1);
  });
});

describe('PlanScreen — survey config persistence (E11)', () => {
  it('keeps the survey form values across drawer-tab switches', async () => {
    const c = mount(makeHarness());
    await settle();
    fireEvent.click(c.querySelector('[data-testid="plan-tab-survey"]') as HTMLButtonElement);
    const alt = c.querySelector('[data-testid="survey-altitude"]') as HTMLInputElement;
    fireEvent.input(alt, { target: { value: '123' } });
    // Switch away and back: the value must persist (session-held config).
    fireEvent.click(c.querySelector('[data-testid="plan-tab-fence"]') as HTMLButtonElement);
    fireEvent.click(c.querySelector('[data-testid="plan-tab-survey"]') as HTMLButtonElement);
    await settle();
    expect((c.querySelector('[data-testid="survey-altitude"]') as HTMLInputElement).value).toBe(
      '123',
    );
  });
});

// --------------------------------------------------------------------------
// Shell integration: navigating to Plan mounts the real screen
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

describe('PlanScreen — shell registration', () => {
  it('replaces the Plan placeholder so the dock mounts the real screen', async () => {
    const h = makeHarness();
    const store: Store<AppState> = createAppStore();
    const registry = createUiRegistry();
    const planT: TFn = t;
    setScreenPanel('plan', createPlanScreenPanel({ services: h.services, t: planT }));

    const ctx: ShellContextValue = {
      store,
      registry,
      capabilities: makeCaps(),
      panelApi: { store, t },
    };
    const { container, getByRole } = render(() => createComponent(Shell, { ctx }));
    await settle();

    // Navigate to Plan, then the real composed screen is mounted (no placeholder).
    fireEvent.click(getByRole('button', { name: t('nav.plan') }));
    await settle();
    expect(container.querySelector('.mvp-plan')).toBeTruthy();
    expect(container.querySelector('.mvp-wptable')).toBeTruthy();
    expect(container.querySelector('.mvp-screen__hint')).toBeNull();
  });
});
