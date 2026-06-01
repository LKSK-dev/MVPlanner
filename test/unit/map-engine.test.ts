/**
 * Raster map engine tests (task T2.3). Camera state (pan/zoom), event emission
 * (move/click), layer dispatch with a working `project()`, and prefetch. The
 * imperative canvas drawing is canvas-deferred (happy-dom's 2d context is
 * `null`), so pixel output is not asserted; the engine still runs layers and
 * camera math, which is what overlays (T2.4) depend on.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRasterMapEngine, type RasterMapEngine } from '../../src/ui/widgets/map';
import { projectToScreen } from '../../src/geo/tiles';
import type { Bbox, MapLayer } from '../../src/contracts';
import type { TileCache as GeoTileCache } from '../../src/geo/tiles';

/** A no-op tile cache that records prefetch calls (engine only uses get/prefetch). */
function fakeCache(): { cache: GeoTileCache; prefetched: number[] } {
  const prefetched: number[] = [];
  const cache: GeoTileCache = {
    get: async () => undefined,
    getCached: async () => undefined,
    put: async () => undefined,
    has: async () => false,
    prefetch: async (_source, tiles) => {
      prefetched.push(tiles.length);
      return { requested: tiles.length, fetched: 0, cached: 0, failed: 0 };
    },
    evict: async () => 0,
    clear: async () => undefined,
  };
  return { cache, prefetched };
}

function makeEngine(over: Partial<Parameters<typeof createRasterMapEngine>[0]> = {}): {
  engine: RasterMapEngine;
  canvas: HTMLCanvasElement;
} {
  const { cache } = fakeCache();
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const engine = createRasterMapEngine({
    cache,
    view: { lat: 0, lon: 0, zoom: 4 },
    // synchronous frame scheduler so redraws happen inline in tests
    requestFrame: (cb) => {
      cb();
      return 0;
    },
    cancelFrame: () => undefined,
    isOnline: () => false,
    ...over,
  });
  engine.attach(canvas);
  return { engine, canvas };
}

describe('camera state', () => {
  it('reports and replaces the view, clamping zoom', () => {
    const { engine } = makeEngine({ minZoom: 1, maxZoom: 10 });
    expect(engine.getView()).toEqual({ lat: 0, lon: 0, zoom: 4 });
    engine.setView({ zoom: 50 });
    expect(engine.getView().zoom).toBe(10);
    engine.setView({ zoom: -5 });
    expect(engine.getView().zoom).toBe(1);
  });

  it('pans east by one tile width', () => {
    const { engine } = makeEngine();
    const before = engine.getView();
    // 256 device px east at z4 ⇒ exactly one tile of longitude.
    engine.panByPixels(256, 0);
    const after = engine.getView();
    expect(after.lon).toBeGreaterThan(before.lon);
    expect(after.lat).toBeCloseTo(before.lat, 9);
    // one tile at z4 spans 360/2^4 = 22.5° of longitude
    expect(after.lon - before.lon).toBeCloseTo(22.5, 4);
  });

  it('zooms and clamps', () => {
    const { engine } = makeEngine({ minZoom: 0, maxZoom: 6 });
    engine.zoomBy(1);
    expect(engine.getView().zoom).toBe(5);
    engine.zoomBy(10);
    expect(engine.getView().zoom).toBe(6);
  });

  it('keeps the anchor point stationary when zooming about it', () => {
    const { engine } = makeEngine();
    const anchor = { x: 400, y: 150 };
    const before = engine.unproject(anchor.x, anchor.y);
    engine.zoomBy(1, anchor);
    const after = engine.unproject(anchor.x, anchor.y);
    expect(after.lat).toBeCloseTo(before.lat, 4);
    expect(after.lon).toBeCloseTo(before.lon, 4);
  });
});

describe('events', () => {
  it('emits move on camera changes and stops after unsubscribe', () => {
    const { engine } = makeEngine();
    const moves: { lat: number; lon: number }[] = [];
    const off = engine.on('move', (e) => moves.push(e));
    engine.panByPixels(100, 0);
    engine.zoomBy(1);
    expect(moves.length).toBe(2);
    off();
    engine.panByPixels(100, 0);
    expect(moves.length).toBe(2);
  });

  it('emits click with the unprojected lat/lon for a pixel', () => {
    const { engine } = makeEngine();
    const clicks: { lat: number; lon: number }[] = [];
    engine.on('click', (e) => clicks.push(e));
    engine.clickAt(400, 150);
    expect(clicks).toHaveLength(1);
    const expected = engine.unproject(400, 150);
    expect(clicks[0]!.lat).toBeCloseTo(expected.lat, 9);
    expect(clicks[0]!.lon).toBeCloseTo(expected.lon, 9);
    // centre click ⇒ the view centre
    engine.clickAt(256, 256);
    expect(clicks[1]!.lat).toBeCloseTo(0, 6);
    expect(clicks[1]!.lon).toBeCloseTo(0, 6);
  });
});

describe('layers', () => {
  it('invokes layer.render every frame with a working project()', () => {
    const { engine, canvas } = makeEngine();
    const render = vi.fn((ctx: Parameters<MapLayer['render']>[0]) => {
      // project the view centre ⇒ canvas centre
      const [x, y] = ctx.project(0, 0);
      expect(x).toBeCloseTo(256, 6);
      expect(y).toBeCloseTo(256, 6);
      expect(ctx.canvas).toBe(canvas);
    });
    const layer: MapLayer = { id: 'overlay', render };
    const dispose = engine.addLayer(layer);
    engine.redrawNow();
    expect(render).toHaveBeenCalled();

    // project agrees with the pure helper for an off-centre point
    const vp = { ...engine.getView(), width: canvas.width, height: canvas.height };
    const lastCtx = render.mock.calls.at(-1)![0];
    expect(lastCtx.project(20, 30)).toEqual(projectToScreen(20, 30, vp));

    dispose();
    render.mockClear();
    engine.redrawNow();
    expect(render).not.toHaveBeenCalled();
  });
});

describe('prefetch + basemap', () => {
  it('prefetches every integer zoom across the range', async () => {
    const { cache, prefetched } = fakeCache();
    const engine = createRasterMapEngine({
      cache,
      isOnline: () => true,
      requestFrame: (cb) => {
        cb();
        return 0;
      },
    });
    const bbox: Bbox = [-1, -1, 1, 1];
    await engine.prefetch(bbox, [3, 5]);
    expect(prefetched).toHaveLength(3); // z3, z4, z5
    expect(prefetched.every((n) => n > 0)).toBe(true);
  });

  it('swaps the basemap source', () => {
    const { engine } = makeEngine();
    expect(engine.getBasemap().id).toBe('carto-dark');
    engine.setBasemap({ id: 'custom', kind: 'xyz', url: 'https://c/{z}/{x}/{y}.png' });
    expect(engine.getBasemap().id).toBe('custom');
  });
});

describe('tile fallback (anti-flash)', () => {
  it('draws a scaled crop of a cached parent tile while the exact tile loads', async () => {
    const drawCalls: unknown[][] = [];
    const ctx2d = {
      clearRect: (): void => undefined,
      drawImage: (...args: unknown[]): void => {
        drawCalls.push(args);
      },
    };
    const canvas = {
      width: 512,
      height: 512,
      getContext: (): unknown => ctx2d,
    } as unknown as HTMLCanvasElement;

    // The cache yields a blob only for parent tiles (z <= 4); deeper tiles miss.
    const cache: GeoTileCache = {
      get: async (_source, tile) => (tile.z <= 4 ? new Blob(['x']) : undefined),
      getCached: async () => undefined,
      put: async () => undefined,
      has: async () => false,
      prefetch: async () => ({ requested: 0, fetched: 0, cached: 0, failed: 0 }),
      evict: async () => 0,
      clear: async () => undefined,
    };
    let seq = 0;
    const engine = createRasterMapEngine({
      cache,
      view: { lat: 0, lon: 0, zoom: 4 },
      requestFrame: (cb) => {
        cb();
        return 0;
      },
      cancelFrame: () => undefined,
      isOnline: () => false,
      createBitmap: async () =>
        ({ width: 256, height: 256, id: seq++ }) as unknown as CanvasImageSource,
    });
    engine.attach(canvas);
    // Let the z4 parent tiles load + repaint.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    drawCalls.length = 0;
    // Zoom to 5: the exact z5 tiles miss, but their z4 parents are cached, so
    // the engine must draw scaled 9-arg crops (no blank flash).
    engine.setView({ zoom: 5 });
    engine.redrawNow();
    const cropDraws = drawCalls.filter((a) => a.length === 9);
    expect(cropDraws.length).toBeGreaterThan(0);
  });
});
