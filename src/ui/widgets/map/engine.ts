/**
 * Canvas raster map engine (task T2.3; spec plan/02 §2.5 map abstraction,
 * plan/04 §4.2 map). The concrete v1 implementation of the frozen
 * {@link MapEngine} seam (`src/contracts/map.ts`): a dependency-free `<canvas>`
 * raster (XYZ/WMS) tile renderer. The same seam later admits a MapLibre GL
 * vector engine without touching callers (deferred post-v1).
 *
 * Responsibilities:
 * - hold the camera ({@link MapView}: center + fractional zoom) and a basemap
 *   {@link BasemapSource};
 * - draw visible tiles for the current view each frame (coalesced via rAF),
 *   loading + caching them through the injected {@link TileCache};
 * - run registered {@link MapLayer}s every frame with a working
 *   {@link MapRenderCtx} (this is how T2.4 draws vehicle/track/mission overlays);
 * - emit `move` (center changes) and `click` (pixel → lat/lon) events;
 * - prefetch an area for offline use.
 *
 * The imperative canvas drawing is the "canvas-deferred" part (a `null` 2d
 * context under happy-dom is tolerated); the camera math, event emission and
 * layer dispatch are pure and unit-tested. All environment access (rAF,
 * `createImageBitmap`, online state, clock) is injected — no hard-bound globals.
 */
import {
  DEFAULT_XYZ_SOURCE,
  projectToScreen,
  tileCacheKey,
  tileScreenRect,
  tileZoomFor,
  tilesInBbox,
  unprojectScreen,
  visibleTiles,
  worldToLonLat,
  lonLatToWorld,
  clamp,
  type TileCache,
  type TileCoord,
  type Viewport,
} from '../../../geo/tiles';
import type { BasemapSource, Bbox, MapEngine, MapLayer, MapRenderCtx } from '../../../contracts';

/** A geographic point as emitted by the {@link MapEngine} `on` events. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** A drawable canvas image (the result of {@link RasterMapEngineOptions.createBitmap}). */
export type TileImage = CanvasImageSource;

/** Options for {@link createRasterMapEngine}. */
export interface RasterMapEngineOptions {
  /** Tile cache (storage-backed in the app; a fake in tests). */
  cache: TileCache;
  /** Initial basemap (default {@link DEFAULT_XYZ_SOURCE}). */
  source?: BasemapSource;
  /** Initial camera; missing fields default to a world view at `{0,0}` z2. */
  view?: Partial<MapView>;
  /** Minimum zoom (default 0). */
  minZoom?: number;
  /** Maximum zoom (default 19). */
  maxZoom?: number;
  /** Online predicate (default `navigator.onLine`); drives offline fallback. */
  isOnline?: () => boolean;
  /** Blob → drawable image (default `createImageBitmap`); injectable for tests. */
  createBitmap?: (blob: Blob) => Promise<TileImage>;
  /** Schedule a frame (default `requestAnimationFrame`); returns a handle. */
  requestFrame?: (cb: () => void) => number;
  /** Cancel a scheduled frame (default `cancelAnimationFrame`). */
  cancelFrame?: (handle: number) => void;
  /** Max decoded tile images kept in memory (default 512). */
  maxBitmaps?: number;
}

/** The camera shape (re-exported for callers). */
export interface MapView {
  lat: number;
  lon: number;
  zoom: number;
}

/**
 * The raster map engine. Implements {@link MapEngine} and adds the imperative
 * camera/canvas controls the widget (and tests) drive. Construct via
 * {@link createRasterMapEngine}.
 */
export interface RasterMapEngine extends MapEngine {
  /** Bind the engine to a canvas and start rendering. */
  attach(canvas: HTMLCanvasElement): void;
  /** Unbind from the canvas and stop rendering. */
  detach(): void;
  /** Current camera. */
  getView(): MapView;
  /** Replace the camera (clamps zoom; emits `move`). */
  setView(view: Partial<MapView>): void;
  /** Shift the center by a screen-pixel delta (emits `move`). */
  panByPixels(dx: number, dy: number): void;
  /** Change zoom by `dz`, optionally keeping a screen anchor fixed (emits `move`). */
  zoomBy(dz: number, anchor?: { x: number; y: number }): void;
  /** Project a coordinate to a device-pixel canvas point for the current view. */
  project(lat: number, lon: number): [number, number];
  /** Invert a device-pixel canvas point back to a coordinate. */
  unproject(px: number, py: number): LatLon;
  /** Emit a `click` for a device-pixel canvas point. */
  clickAt(px: number, py: number): void;
  /** The active basemap source. */
  getBasemap(): BasemapSource;
  /** Force a synchronous redraw (bypasses rAF; used by the render loop + tests). */
  redrawNow(): void;
  /** Schedule a coalesced redraw on the next frame. */
  requestRedraw(): void;
}

/** Default blob → bitmap using the platform `createImageBitmap` when present. */
async function defaultCreateBitmap(blob: Blob): Promise<TileImage> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob);
  throw new Error('createImageBitmap is unavailable');
}

/** Default online predicate, tolerant of non-browser environments. */
function defaultIsOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

/** Default frame scheduler, falling back to a macrotask when rAF is absent. */
function defaultRequestFrame(cb: () => void): number {
  if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(cb);
  return setTimeout(cb, 16) as unknown as number;
}

/** Cancel a frame scheduled by {@link defaultRequestFrame}. */
function defaultCancelFrame(handle: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  else clearTimeout(handle);
}

/** Best-effort release of a decoded bitmap (only `ImageBitmap` has `close`). */
function closeBitmap(img: TileImage): void {
  const closable = img as { close?: () => void };
  if (typeof closable.close === 'function') closable.close();
}

/**
 * Create a {@link RasterMapEngine}. Nothing is drawn until {@link RasterMapEngine.attach}
 * binds a canvas.
 */
export function createRasterMapEngine(options: RasterMapEngineOptions): RasterMapEngine {
  const cache = options.cache;
  const minZoom = options.minZoom ?? 0;
  const maxZoom = options.maxZoom ?? 19;
  const isOnline = options.isOnline ?? defaultIsOnline;
  const createBitmap = options.createBitmap ?? defaultCreateBitmap;
  const requestFrame = options.requestFrame ?? defaultRequestFrame;
  const cancelFrame = options.cancelFrame ?? defaultCancelFrame;
  const maxBitmaps = options.maxBitmaps ?? 512;

  let source: BasemapSource = options.source ?? DEFAULT_XYZ_SOURCE;
  let view: MapView = {
    lat: options.view?.lat ?? 0,
    lon: options.view?.lon ?? 0,
    zoom: clamp(options.view?.zoom ?? 2, minZoom, maxZoom),
  };

  let canvas: HTMLCanvasElement | undefined;
  let frameHandle: number | undefined;

  const layers: MapLayer[] = [];
  const clickListeners = new Set<(e: LatLon) => void>();
  const moveListeners = new Set<(e: LatLon) => void>();

  /** Decoded tile images, insertion-ordered for simple LRU trimming. */
  const bitmaps = new Map<string, TileImage>();
  /** Keys with an in-flight load, to dedupe concurrent fetches. */
  const pending = new Set<string>();
  /**
   * Invalidation generation: bumped on detach()/setBasemap(). In-flight tile
   * loads capture the generation at start; results from a stale generation are
   * closed + dropped instead of inserted (no leak, no stale-key redraw).
   */
  let generation = 0;

  function viewport(): Viewport {
    return {
      lat: view.lat,
      lon: view.lon,
      zoom: view.zoom,
      width: canvas?.width ?? 0,
      height: canvas?.height ?? 0,
    };
  }

  function emitMove(): void {
    for (const cb of moveListeners) cb({ lat: view.lat, lon: view.lon });
  }

  function trimBitmaps(): void {
    while (bitmaps.size > maxBitmaps) {
      const oldest = bitmaps.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const img = bitmaps.get(oldest);
      bitmaps.delete(oldest);
      if (img) closeBitmap(img);
    }
  }

  function ensureTile(tile: TileCoord, key: string): void {
    if (pending.has(key) || bitmaps.has(key)) return;
    pending.add(key);
    const startedGeneration = generation;
    void cache
      .get(source, tile, { online: isOnline() })
      .then(async (blob) => {
        pending.delete(key);
        if (!blob) return;
        try {
          const img = await createBitmap(blob);
          if (startedGeneration !== generation) {
            // detach()/setBasemap() happened mid-load: drop the stale result.
            closeBitmap(img);
            return;
          }
          bitmaps.set(key, img);
          trimBitmaps();
          requestRedraw();
        } catch {
          /* decode failure → leave the tile blank this frame */
        }
      })
      .catch(() => {
        pending.delete(key);
      });
  }

  /**
   * Find the nearest cached ancestor tile (lower zoom) for a target tile, so a
   * scaled crop of it can stand in while the exact tile is still loading. This
   * is what prevents the canvas from flashing to blank during loads and when
   * the integer tile zoom switches mid-zoom.
   */
  function bestAncestor(tile: TileCoord, tz: number): { img: TileImage; k: number } | undefined {
    for (let k = 1; tz - k >= minZoom; k++) {
      const frac = 2 ** k;
      const ax = Math.floor(tile.x / frac);
      const ay = Math.floor(tile.y / frac);
      const img = bitmaps.get(tileCacheKey(source.id, { z: tz - k, x: ax, y: ay }));
      if (img) return { img, k };
    }
    return undefined;
  }

  function draw(): void {
    if (!canvas) return;
    const vp = viewport();
    const ctx2d = canvas.getContext('2d');
    if (ctx2d) {
      ctx2d.clearRect(0, 0, canvas.width, canvas.height);
      const tz = tileZoomFor(view.zoom, minZoom, maxZoom);
      for (const tile of visibleTiles(vp, tz)) {
        const key = tileCacheKey(source.id, tile);
        const img = bitmaps.get(key);
        const rect = tileScreenRect(tile, vp, tz);
        if (img) {
          ctx2d.drawImage(img, rect.x, rect.y, rect.size, rect.size);
        } else {
          // Draw a scaled crop of the nearest cached parent tile as a stand-in
          // so coverage stays continuous (no blank flash) until `key` loads.
          const anc = bestAncestor(tile, tz);
          if (anc) {
            const frac = 2 ** anc.k;
            const tilePx = (anc.img as { width?: number }).width ?? 256;
            const srcSize = tilePx / frac;
            const srcX = (((tile.x % frac) + frac) % frac) * srcSize;
            const srcY = (((tile.y % frac) + frac) % frac) * srcSize;
            try {
              ctx2d.drawImage(
                anc.img,
                srcX,
                srcY,
                srcSize,
                srcSize,
                rect.x,
                rect.y,
                rect.size,
                rect.size,
              );
            } catch {
              /* happy-dom / partial canvas: skip the fallback draw this frame */
            }
          }
          ensureTile(tile, key);
        }
      }
    }
    const renderCtx: MapRenderCtx = {
      canvas,
      project: (lat: number, lon: number): [number, number] => projectToScreen(lat, lon, vp),
    };
    for (const layer of layers) layer.render(renderCtx);
  }

  function requestRedraw(): void {
    if (frameHandle !== undefined) return;
    frameHandle = requestFrame(() => {
      frameHandle = undefined;
      draw();
    });
  }

  function setView(next: Partial<MapView>): void {
    const lat = next.lat ?? view.lat;
    const lon = next.lon ?? view.lon;
    const zoom = clamp(next.zoom ?? view.zoom, minZoom, maxZoom);
    const moved = lat !== view.lat || lon !== view.lon || zoom !== view.zoom;
    view = { lat, lon, zoom };
    if (moved) {
      emitMove();
      requestRedraw();
    }
  }

  function panByPixels(dx: number, dy: number): void {
    const [cx, cy] = lonLatToWorld(view.lon, view.lat, view.zoom);
    const [lon, lat] = worldToLonLat(cx + dx, cy + dy, view.zoom);
    setView({ lat, lon });
  }

  function zoomBy(dz: number, anchor?: { x: number; y: number }): void {
    const nextZoom = clamp(view.zoom + dz, minZoom, maxZoom);
    if (nextZoom === view.zoom) return;
    if (!anchor) {
      setView({ zoom: nextZoom });
      return;
    }
    // Keep the geographic point under `anchor` stationary across the zoom.
    const before = unprojectScreen(anchor.x, anchor.y, viewport());
    view = { ...view, zoom: nextZoom };
    const [ax, ay] = projectToScreen(before.lat, before.lon, viewport());
    const [cx, cy] = lonLatToWorld(view.lon, view.lat, view.zoom);
    const [lon, lat] = worldToLonLat(cx + (ax - anchor.x), cy + (ay - anchor.y), view.zoom);
    view = { lat, lon, zoom: nextZoom };
    emitMove();
    requestRedraw();
  }

  const engine: RasterMapEngine = {
    attach(nextCanvas: HTMLCanvasElement): void {
      canvas = nextCanvas;
      requestRedraw();
    },

    detach(): void {
      generation++;
      if (frameHandle !== undefined) {
        cancelFrame(frameHandle);
        frameHandle = undefined;
      }
      for (const img of bitmaps.values()) closeBitmap(img);
      bitmaps.clear();
      pending.clear();
      canvas = undefined;
    },

    getView(): MapView {
      return { ...view };
    },

    setView,
    panByPixels,
    zoomBy,

    project(lat: number, lon: number): [number, number] {
      return projectToScreen(lat, lon, viewport());
    },

    unproject(px: number, py: number): LatLon {
      return unprojectScreen(px, py, viewport());
    },

    clickAt(px: number, py: number): void {
      const { lat, lon } = unprojectScreen(px, py, viewport());
      for (const cb of clickListeners) cb({ lat, lon });
    },

    getBasemap(): BasemapSource {
      return source;
    },

    redrawNow(): void {
      draw();
    },

    requestRedraw,

    addLayer(layer: MapLayer): () => void {
      layers.push(layer);
      requestRedraw();
      return (): void => {
        const i = layers.indexOf(layer);
        if (i >= 0) layers.splice(i, 1);
        requestRedraw();
      };
    },

    on(ev: 'click' | 'move', cb: (e: LatLon) => void): () => void {
      const set = ev === 'click' ? clickListeners : moveListeners;
      set.add(cb);
      return (): void => {
        set.delete(cb);
      };
    },

    setBasemap(next: BasemapSource): void {
      generation++;
      source = next;
      // Tiles from the previous source are no longer valid for this view.
      for (const img of bitmaps.values()) closeBitmap(img);
      bitmaps.clear();
      pending.clear();
      requestRedraw();
    },

    async prefetch(bbox: Bbox, zoomRange: [number, number]): Promise<void> {
      const lo = Math.min(zoomRange[0], zoomRange[1]);
      const hi = Math.max(zoomRange[0], zoomRange[1]);
      for (let z = lo; z <= hi; z++) {
        const tiles = tilesInBbox(bbox, z);
        await cache.prefetch(source, tiles, { online: isOnline() });
      }
    },
  };

  return engine;
}
