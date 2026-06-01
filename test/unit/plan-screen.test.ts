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
  BlobStore,
  FileIo,
  Mission,
  MissionClient,
  Param,
  ParamClient,
  Store,
} from '../../src/contracts';
import type { ElevationProvider } from '../../src/geo/terrain';
import { createAppStore } from '../../src/core/store';
import { createRasterMapEngine, type RasterMapEngine } from '../../src/ui/widgets/map';
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
import { PlanScreen, createPlanScreenPanel, type TFn } from '../../src/ui/screens/plan';
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
