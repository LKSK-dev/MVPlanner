# `geo/tiles` — Web-Mercator math + tile cache (T2.3)

Spec: `plan/02` §2.5, `plan/04` §4.2, `plan/07` §7.2 (tiles) / §7.8 (offline).

Dependency-free, DOM-free foundation under the canvas raster map engine
(`ui/widgets/map`). Everything here is pure (or storage/fetch-injected) and
unit-tested — see `test/unit/tiles-mercator.test.ts` and
`test/unit/tiles-cache.test.ts`.

## Modules

- **`mercator.ts`** — Web-Mercator (EPSG:3857) slippy-map math: `lonLatToWorld`
  / `worldToLonLat` (inverse, for click hit-testing), `lonLatToTile`,
  `tileExtent3857`, `worldSize`, `clampLat`, `wrapTileX`.
- **`viewport.ts`** — camera ↔ canvas: `projectToScreen` (the function exposed to
  layers as `MapRenderCtx.project`, `lat, lon` order), `unprojectScreen`,
  `visibleTiles`, `tileScreenRect`, `tilesInBbox`, `tileZoomFor`.
- **`source.ts`** — basemap URL templating: `tileUrl` (XYZ `{z}{x}{y}{-y}{s}` +
  `{apiKey}`; WMS `{bbox-epsg-3857}{width}{height}`), `wmsSource` builder,
  `DEFAULT_XYZ_SOURCE` (OSM-style, user-configurable).
- **`cache.ts`** — `createTileCache`: cache-first tile store over the frozen
  `BlobStore` (namespace `tiles`) with an **injected `fetch`**. Offline serves
  cached tiles and never hard-fails; bounded count/age eviction; `prefetch` for
  offline areas; `clear`.
- **`types.ts`** — `TileCoord`, `MapView`, `Viewport`.

Conventions: world pixels span `[0, 256·2^z)`, origin top-left (north-west);
canvas pixels are device pixels. See `ui/widgets/map/README.md` for the full
engine/layer/event API.
