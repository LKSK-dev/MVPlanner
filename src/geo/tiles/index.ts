/**
 * `geo/tiles` public surface (task T2.3; spec plan/02 §2.5, plan/04 §4.2 map,
 * plan/07 §7.2 tiles). Dependency-free Web-Mercator slippy-map math, basemap
 * URL templating and an IndexedDB-backed tile cache — the pure foundation under
 * the canvas raster map engine (`ui/widgets/map`). Cross-module consumers import
 * from here, never deep paths (conventions plan/implementation/00 §0.3).
 */
export type { TileCoord, MapView, Viewport } from './types';

export {
  TILE_SIZE,
  MAX_MERCATOR_LAT,
  MERCATOR_EXTENT,
  clamp,
  clampLat,
  wrapTileX,
  worldSize,
  lonLatToWorld,
  worldToLonLat,
  lonLatToTile,
  tileExtent3857,
} from './mercator';

export {
  projectToScreen,
  unprojectScreen,
  tileZoomFor,
  tileScreenRect,
  visibleTiles,
  tilesInBbox,
} from './viewport';

export {
  DEFAULT_SUBDOMAINS,
  DEFAULT_XYZ_SOURCE,
  tileUrl,
  wmsSource,
  type TileUrlOptions,
  type WmsSourceOptions,
} from './source';

export {
  createTileCache,
  tileCacheKey,
  TILE_NAMESPACE,
  DEFAULT_MAX_ENTRIES,
  type TileCache,
  type TileCacheOptions,
  type TileGetOptions,
  type PrefetchResult,
  type FetchFn,
  type FetchResponseLike,
} from './cache';
