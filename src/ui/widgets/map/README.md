# `ui/widgets/map` — Map engine + raster renderer (T2.3)

Spec: `plan/02` §2.5 (map abstraction), `plan/04` §4.2 (map), `plan/05`
§5.4/§5.5/§5.8, `plan/07` §7.2 (tiles) / §7.8 (offline). Contract:
`src/contracts/map.ts` (FROZEN `MapEngine`, `MapLayer`, `MapRenderCtx`,
`BasemapSource`, `Bbox`).

## What this is

The **v1** map is a **dependency-free `<canvas>` raster tile renderer** behind
the frozen `MapEngine` seam — no `maplibre-gl`, no `leaflet`, no worker, no WASM.
A MapLibre GL vector engine can be added later behind the **same** seam without
touching callers (deferred post-v1).

Two layers:

- **`src/geo/tiles/**`\*\* — pure, dependency-free Web-Mercator (EPSG:3857)
  slippy-map math, basemap URL templating, and an IndexedDB-backed tile cache.
- **`src/ui/widgets/map/**`** — the canvas raster `RasterMapEngine`(implements`MapEngine`) and the Solid `MapWidget` that mounts + drives it.

## Engine API (for the Flight/Plan screens and T2.4 overlays)

```ts
import { createRasterMapEngine, createTileCache, MapWidget } from 'ui/widgets/map';

const cache = createTileCache({ blobs: storage.blobs, fetch }); // inject fetch + storage
const engine = createRasterMapEngine({ cache, view: { lat, lon, zoom } });

// MapEngine (frozen contract):
const off = engine.addLayer({ id: 'vehicle', render(ctx) { /* draw via ctx.project + ctx.canvas */ } });
const offClick = engine.on('click', ({ lat, lon }) => { /* guided fly-here */ });
const offMove = engine.on('move', ({ lat, lon }) => {});
engine.setBasemap({ id, kind: 'xyz' | 'wms', url, apiKey });
await engine.prefetch([west, south, east, north], [minZoom, maxZoom]); // offline area

// Extra camera/canvas controls the widget (and tests) use:
engine.attach(canvas); engine.detach();
engine.getView(); engine.setView({ lat, lon, zoom });
engine.panByPixels(dx, dy); engine.zoomBy(dz, anchorPx?);
engine.project(lat, lon); engine.unproject(px, py); engine.clickAt(px, py);
```

### How T2.4 overlays draw

`engine.addLayer(layer)` runs `layer.render(ctx)` **every frame** with a
`MapRenderCtx`:

- `ctx.project(lat, lon) → [x, y]` — device-pixel canvas point for the current
  camera (Web-Mercator). Use it to place the vehicle icon, track polyline,
  mission path, fence/rally geometry.
- `ctx.canvas` — the `HTMLCanvasElement`; get a `2d` context and draw on top of
  the basemap tiles. Layers run after tiles each frame.

`addLayer` returns a disposer that removes the layer. Layers are drawn in
insertion order. Trigger a redraw after mutating layer data with
`engine.requestRedraw()`.

### Events

`engine.on('click', cb)` fires `{ lat, lon }` for a non-drag tap (used for
guided "fly here" / ROI). `engine.on('move', cb)` fires the new center on every
camera change (pan/zoom). Both return a disposer.

## Widget

```tsx
import { MapWidget } from 'ui/widgets/map';
import 'ui/widgets/map/map.css'; // integration step

<MapWidget engine={engine} />;
```

The widget is **store-agnostic**: the screen builds the engine (with a
storage-backed cache + overlay layers) and passes it in. The widget owns only
the DOM, sizing and accessibility:

- **Pan**: drag (pointer). **Zoom**: wheel, two-finger pinch, and +/− buttons.
- **Keyboard**: arrow keys pan, `+`/`-` zoom (focusable `role="application"`
  with an `aria-label`).
- **Readout**: an `aria-live` center/zoom line.
- HiDPI via `ResizeObserver` + `devicePixelRatio`. DOM events are CSS pixels;
  the widget converts to device pixels before calling the engine, so projection
  matches what is drawn.

## Tile sources & cache

- **XYZ** templates: `{z}` `{x}` `{y}` `{-y}` (TMS) `{s}` (subdomains)
  `{apiKey}`/`{key}`. **WMS** templates: `{bbox-epsg-3857}` `{width}` `{height}`
  — build one with `wmsSource({ baseUrl, layers, ... })`.
- **Default source** `DEFAULT_XYZ_SOURCE` is OSM-style
  (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) and is **user-configurable**
  (Settings, T3.7) — documented, not hard-wired.
- **Cache** (`createTileCache`): cache-first reads from the injected `BlobStore`
  (namespace `tiles`, key `"<sourceId>/<z>/<x>/<y>"`); misses fetch via the
  injected `fetch`-like only when `online`. **Offline serves cached tiles and
  never hard-fails** (§7.8). Bounded eviction by entry count + optional age
  (`evict()`, called after `prefetch`); `clear(sourceId?)` wipes the cache.

`fetch` and storage are **injected** (no hard-bound globals) for testability.

## Pure-tested vs canvas-deferred

- **Pure (`test/unit/tiles-mercator.test.ts`)** — all Mercator math
  (`lonLatToWorld`/`worldToLonLat`/`lonLatToTile`/`tileExtent3857`), viewport
  math (`projectToScreen`/`unprojectScreen`/`visibleTiles`/`tileScreenRect`/
  `tilesInBbox`/`tileZoomFor`) and URL templating (`tileUrl`/`wmsSource`).
- **Cache (`test/unit/tiles-cache.test.ts`)** — hit/miss, offline, non-2xx,
  fetch-rejection, prefetch counts/progress, count + age eviction, clear — with
  a mock fetch and a fake-indexeddb `BlobStore`.
- **Engine (`test/unit/map-engine.test.ts`)** — camera state (pan/zoom/clamp,
  anchor-stable zoom), `move`/`click` events, `layer.render` invoked with a
  working `project()`, prefetch across a zoom range, basemap swap.
- **Widget (`test/unit/map-widget.test.ts`)** — mounts, accessible region +
  aria-label, live readout, zoom buttons + keyboard drive the engine.
- **Canvas-deferred** — the imperative tile `drawImage` loop in `engine.draw()`.
  happy-dom returns a `null` 2d context, so tile pixels are not asserted; the
  draw path is guarded and exercised by the live e2e/perf rig at the M2 gate
  (pan/zoom 60 fps). Layer dispatch + camera math still run without a 2d context.

## Owned files

`src/ui/widgets/map/**` (`engine.ts`, `map.tsx`, `map.css`, `messages.ts`,
`index.ts`, this README), `src/geo/tiles/**` (`mercator.ts`, `viewport.ts`,
`source.ts`, `cache.ts`, `types.ts`, `index.ts`), and `test/unit/map*.test.ts` +
`test/unit/tiles*.test.ts`.

## i18n

`map.*` strings are contributed at import time via `registerMessages` in
`./messages` — no central catalog edit.

## Deferred (post-v1, same seam)

MapLibre GL vector basemaps + GPU rendering; measure distance/area + marker
tools (`plan/04` §4.2) layer onto the engine later; terrain elevation sampling
(T4.8) reuses `geo/tiles` math.
