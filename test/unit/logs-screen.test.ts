/**
 * Logs & analysis screen assembly + map-track sync tests (tasks T6.5 + T6.8;
 * spec plan/04 §4.7/§4.8/§4.9, plan/05 §5.4 Logs).
 *
 * Covers:
 *  - the PURE cursor⇄track-position core (GPS series → track, interpolation,
 *    nearest-time, source detection);
 *  - opening a synthetic decoded `.bin` populates the series picker and adding a
 *    series renders it in the plotter;
 *  - the composed screen renders source-picker + plotter + map + inspector +
 *    sender + playback, and navigating to Logs in the shell mounts the real
 *    screen over the placeholder;
 *  - CSV export calls the FileIo save seam.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type { BlobStore, FileIo } from '../../src/contracts';
import type { LogSeriesData } from '../../src/data/log-query';
import type { InspectorSnapshot } from '../../src/ui/widgets/inspector';
import { createAppStore } from '../../src/core/store';
import { createRasterMapEngine, type RasterMapEngine } from '../../src/ui/widgets/map';
import type { TileCache } from '../../src/geo/tiles';
import type { InspectorSource } from '../../src/ui/widgets/inspector';
import {
  LogsScreen,
  buildTrackFromSeries,
  createLogsScreenPanel,
  decodeDataFlashOnMainThread,
  findTrackSource,
  interpolateTrackAt,
  nearestTrackTime,
} from '../../src/ui/screens/logs';
import {
  Shell,
  createUiRegistry,
  setScreenPanel,
  type ShellContextValue,
} from '../../src/ui/shell';
import type { Capabilities } from '../../src/core/capabilities';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

// --------------------------------------------------------------------------
// Synthetic DataFlash .bin fixture (GPS + ATT messages with TimeUS)
// --------------------------------------------------------------------------

const HEADER = [0xa3, 0x95] as const;
const FMT_TYPE = 128;

function writeAscii(bytes: Uint8Array, offset: number, length: number, value: string): void {
  for (let i = 0; i < Math.min(length, value.length); i++) bytes[offset + i] = value.charCodeAt(i);
}

function bodyLengthFor(format: string): number {
  let body = 0;
  for (const char of format) {
    if (char === 'Q') body += 8;
    else if (char === 'L' || char === 'f' || char === 'i') body += 4;
    else if (char === 'h' || char === 'H') body += 2;
    else throw new Error(`fixture char ${char} not supported`);
  }
  return body;
}

function fmtPacket(type: number, name: string, format: string, columns: string): Uint8Array {
  const bytes = new Uint8Array(89);
  bytes[0] = HEADER[0];
  bytes[1] = HEADER[1];
  bytes[2] = FMT_TYPE;
  bytes[3] = type;
  bytes[4] = 3 + bodyLengthFor(format);
  writeAscii(bytes, 5, 4, name);
  writeAscii(bytes, 9, 16, format);
  writeAscii(bytes, 25, 64, columns);
  return bytes;
}

function recordPacket(
  type: number,
  fill: (view: DataView) => void,
  bodyLength: number,
): Uint8Array {
  const bytes = new Uint8Array(3 + bodyLength);
  bytes[0] = HEADER[0];
  bytes[1] = HEADER[1];
  bytes[2] = type;
  fill(new DataView(bytes.buffer, bytes.byteOffset + 3, bodyLength));
  return bytes;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** GPS samples used by both the fixture and the track assertions. */
const GPS_SAMPLES: readonly { timeUs: number; lat: number; lon: number; alt: number }[] = [
  { timeUs: 1_000_000, lat: 37.42, lon: -122.08, alt: 100 },
  { timeUs: 2_000_000, lat: 37.44, lon: -122.06, alt: 110 },
  { timeUs: 3_000_000, lat: 37.46, lon: -122.04, alt: 120 },
];

function buildFixture(): Uint8Array {
  const parts: Uint8Array[] = [
    fmtPacket(200, 'GPS', 'QLLf', 'TimeUS,Lat,Lng,Alt'),
    fmtPacket(201, 'ATT', 'Qff', 'TimeUS,Roll,Pitch'),
  ];
  for (const sample of GPS_SAMPLES) {
    parts.push(
      recordPacket(
        200,
        (view) => {
          view.setBigUint64(0, BigInt(sample.timeUs), true);
          view.setInt32(8, Math.round(sample.lat * 10_000_000), true);
          view.setInt32(12, Math.round(sample.lon * 10_000_000), true);
          view.setFloat32(16, sample.alt, true);
        },
        20,
      ),
    );
    parts.push(
      recordPacket(
        201,
        (view) => {
          view.setBigUint64(0, BigInt(sample.timeUs), true);
          view.setFloat32(8, sample.lat / 10, true);
          view.setFloat32(12, sample.lon / 10, true);
        },
        16,
      ),
    );
  }
  return concatBytes(parts);
}

// --------------------------------------------------------------------------
// Harness
// --------------------------------------------------------------------------

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

function fakeBlobs(): BlobStore {
  return {
    put: async () => undefined,
    getRange: async () => new Uint8Array(0),
    size: async () => 0,
    list: async () => [],
    del: async () => undefined,
  };
}

interface FilesHarness {
  files: FileIo;
  saved: { calls: number; lastName?: string };
}

function fakeFiles(blob: Blob | undefined): FilesHarness {
  const saved: { calls: number; lastName?: string } = { calls: 0 };
  const files: FileIo = {
    openForRead: async () => (blob === undefined ? undefined : { name: 'flight.bin', blob }),
    saveAs: async (_data, name) => {
      saved.calls += 1;
      saved.lastName = name;
    },
  };
  return { files, saved };
}

function mockInspectorSource(): InspectorSource {
  return {
    subscribeInspector: (cb) => {
      const snap: InspectorSnapshot = { rev: 1, rows: [] };
      cb(snap);
      return () => undefined;
    },
  };
}

// --------------------------------------------------------------------------
// Pure track core (T6.5)
// --------------------------------------------------------------------------

describe('logs track — cursor ⇄ position core', () => {
  const lat: LogSeriesData = {
    timesUs: Float64Array.from(GPS_SAMPLES.map((s) => s.timeUs)),
    values: Float64Array.from(GPS_SAMPLES.map((s) => s.lat)),
  };
  const lon: LogSeriesData = {
    timesUs: Float64Array.from(GPS_SAMPLES.map((s) => s.timeUs)),
    values: Float64Array.from(GPS_SAMPLES.map((s) => s.lon)),
  };

  it('builds an ordered track and drops (0,0) no-fix rows', () => {
    const latZero: LogSeriesData = {
      timesUs: Float64Array.from([0, ...GPS_SAMPLES.map((s) => s.timeUs)]),
      values: Float64Array.from([0, ...GPS_SAMPLES.map((s) => s.lat)]),
    };
    const lonZero: LogSeriesData = {
      timesUs: Float64Array.from([0, ...GPS_SAMPLES.map((s) => s.timeUs)]),
      values: Float64Array.from([0, ...GPS_SAMPLES.map((s) => s.lon)]),
    };
    const track = buildTrackFromSeries(latZero, lonZero);
    expect(track).toHaveLength(GPS_SAMPLES.length);
    expect(track[0]?.lat).toBeCloseTo(37.42);
  });

  it('interpolates the track at a plot-cursor timeUs (the sync core)', () => {
    const track = buildTrackFromSeries(lat, lon);
    // Midway between sample 0 (t=1e6) and sample 1 (t=2e6).
    const mid = interpolateTrackAt(track, 1_500_000);
    expect(mid?.lat).toBeCloseTo((37.42 + 37.44) / 2);
    expect(mid?.lon).toBeCloseTo((-122.08 + -122.06) / 2);
    // Before/after clamps to the endpoints.
    expect(interpolateTrackAt(track, 0)?.lat).toBeCloseTo(37.42);
    expect(interpolateTrackAt(track, 9_000_000)?.lat).toBeCloseTo(37.46);
    expect(interpolateTrackAt([], 1)).toBeUndefined();
  });

  it('maps a clicked lat/lon back to the nearest track time', () => {
    const track = buildTrackFromSeries(lat, lon);
    expect(nearestTrackTime(track, 37.459, -122.041)).toBe(3_000_000);
    expect(nearestTrackTime([], 0, 0)).toBeUndefined();
  });

  it('detects the GPS track source from descriptors', () => {
    expect(
      findTrackSource([
        { message: 'GPS', field: 'Lat' },
        { message: 'GPS', field: 'Lng' },
        { message: 'ATT', field: 'Roll' },
      ]),
    ).toEqual({ message: 'GPS', latField: 'Lat', lonField: 'Lng' });
    expect(findTrackSource([{ message: 'ATT', field: 'Roll' }])).toBeUndefined();
  });
});

// --------------------------------------------------------------------------
// Decode → index
// --------------------------------------------------------------------------

describe('logs source — decode .bin into a query index', () => {
  it('decodes a synthetic .bin into listable series with a GPS track', async () => {
    const index = await decodeDataFlashOnMainThread(buildFixture());
    const names = index.listSeries().map((d) => `${d.message}.${d.field}`);
    expect(names).toContain('GPS.Lat');
    expect(names).toContain('GPS.Lng');
    expect(names).toContain('ATT.Roll');

    const latPoints = index.querySeries('GPS', 'Lat', undefined, 1000);
    expect(latPoints.length).toBe(GPS_SAMPLES.length);
    expect(latPoints[0]?.t).toBe(1_000_000);
  });
});

// --------------------------------------------------------------------------
// Composed screen
// --------------------------------------------------------------------------

function mountScreen(blob: Blob | undefined): {
  container: HTMLElement;
  saved: FilesHarness['saved'];
  send: ReturnType<typeof vi.fn>;
} {
  const harness = fakeFiles(blob);
  const send = vi.fn((_name: string, _fields: Record<string, unknown>) => undefined);
  const { container } = render(() =>
    createComponent(LogsScreen, {
      files: harness.files,
      blobs: fakeBlobs(),
      send,
      inspectorSource: mockInspectorSource(),
      t,
      decodeBin: (source) => decodeDataFlashOnMainThread(source),
      createEngine: () => offlineEngine(),
    }),
  );
  return { container, saved: harness.saved, send };
}

afterEach(() => {
  cleanup();
  setScreenPanel('logs', undefined);
});

describe('LogsScreen — composition', () => {
  it('renders source-picker + plotter + map + inspector + sender + playback', async () => {
    const { container } = mountScreen(undefined);
    await settle();

    expect(container.querySelector('.mvp-logs')).toBeTruthy();
    expect(container.querySelector('[data-testid="logs-open-bin"]')).toBeTruthy();
    expect(container.querySelector('.mvp-plotter')).toBeTruthy();
    expect(container.querySelector('.mvp-map')).toBeTruthy();
    expect(container.querySelector('.mvp-logs__series')).toBeTruthy();
    expect(container.querySelector('.mvp-inspector')).toBeTruthy();
    expect(container.querySelector('.mvp-msgsender')).toBeTruthy();
    expect(container.querySelector('.mvp-playback')).toBeTruthy();
  });

  it('opening a .bin populates the series picker and adding a series plots it', async () => {
    const { container } = mountScreen(new Blob([new Uint8Array(buildFixture())]));
    await settle();

    (container.querySelector('[data-testid="logs-open-bin"]') as HTMLButtonElement).click();
    await settle();
    await settle();

    // The series tree now lists GPS/ATT fields.
    const adders = container.querySelectorAll('[data-testid="logs-series-add"]');
    expect(adders.length).toBeGreaterThan(0);

    // Add the GPS.Lat field and assert the plotter reflects the selected series.
    (container.querySelector('[aria-label="Add GPS.Lat"]') as HTMLButtonElement).click();
    await settle();

    expect(container.querySelector('[data-testid="logs-series-remove"]')).toBeTruthy();
    const summary = container.querySelector('.mvp-plotter__summary')?.textContent ?? '';
    expect(summary).toContain('GPS.Lat');
  });

  it('exports the plotted series to CSV via the FileIo save seam', async () => {
    const { container, saved } = mountScreen(new Blob([new Uint8Array(buildFixture())]));
    await settle();

    (container.querySelector('[data-testid="logs-open-bin"]') as HTMLButtonElement).click();
    await settle();
    await settle();
    (container.querySelector('[data-testid="logs-series-add"]') as HTMLButtonElement).click();
    await settle();

    (container.querySelector('[data-testid="logs-export"]') as HTMLButtonElement).click();
    await settle();

    expect(saved.calls).toBe(1);
    expect(saved.lastName).toBe('log-series.csv');
  });
});

// --------------------------------------------------------------------------
// Shell integration
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

describe('LogsScreen — shell registration', () => {
  it('replaces the Logs placeholder so the dock mounts the real screen', async () => {
    const store = createAppStore();
    const registry = createUiRegistry();
    const harness = fakeFiles(undefined);

    setScreenPanel(
      'logs',
      createLogsScreenPanel({
        files: harness.files,
        blobs: fakeBlobs(),
        send: () => undefined,
        inspectorSource: mockInspectorSource(),
        t,
      }),
    );

    const ctx: ShellContextValue = {
      store,
      registry,
      capabilities: makeCaps(),
      panelApi: { store, t },
    };
    const { container } = render(() => createComponent(Shell, { ctx }));
    await settle();

    store.patch((s) => {
      s.layout.activeScreen = 'logs';
    });
    await settle();

    expect(container.querySelector('.mvp-logs')).toBeTruthy();
    expect(container.querySelector('.mvp-plotter')).toBeTruthy();
    expect(container.querySelector('.mvp-screen__hint')).toBeNull();
  });
});
