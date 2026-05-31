/**
 * `ui/widgets/map` public surface (task T2.3; spec plan/02 §2.5 map abstraction,
 * plan/04 §4.2 map, plan/07 §7.2 tiles). A dependency-free `<canvas>` raster
 * (XYZ/WMS) tile map: the concrete v1 implementation of the frozen
 * {@link MapEngine} seam, plus the Solid {@link MapWidget} that mounts it.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). The Flight/Plan screens build the engine with a
 * storage-backed tile cache (`createTileCache` from `geo/tiles`) and add overlay
 * layers (T2.4) via `engine.addLayer`. Mounting also needs `import './map.css'`.
 *
 * Importing this module registers the widget's `map.*` i18n strings.
 *
 * @see ./README.md for the engine/layer/event API and what is pure-tested vs
 *   canvas-deferred.
 */
import './messages';

export { MapWidget, type MapWidgetProps, type TFn } from './map';
export {
  createRasterMapEngine,
  type RasterMapEngine,
  type RasterMapEngineOptions,
  type MapView,
  type LatLon,
  type TileImage,
} from './engine';
export { MAP_MESSAGES } from './messages';

// Re-export the pure tile/geo layer so map consumers have one import site.
export {
  createTileCache,
  tileUrl,
  wmsSource,
  DEFAULT_XYZ_SOURCE,
  type TileCache,
  type TileCoord,
} from '../../../geo/tiles';
