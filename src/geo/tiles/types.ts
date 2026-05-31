/**
 * Shared `geo/tiles` value types (task T2.3; spec plan/07 §7.2 tiles).
 *
 * These are deliberately tiny, dependency-free data shapes used by the pure
 * Web-Mercator math, the tile cache and the canvas raster map engine. They are
 * separate from the frozen map seam (`src/contracts/map.ts`): {@link MapView} /
 * {@link Viewport} describe the raster engine's camera, while {@link TileCoord}
 * is the slippy-map tile address.
 */

/** A slippy-map (XYZ) tile address. `x`/`y` are integer tile indices at zoom `z`. */
export interface TileCoord {
  /** Integer zoom level. */
  z: number;
  /** Tile column (wrapped into `[0, 2^z)` by callers that emit URLs). */
  x: number;
  /** Tile row in `[0, 2^z)`. */
  y: number;
}

/** The map camera: geographic center plus a (possibly fractional) zoom. */
export interface MapView {
  /** Center latitude in degrees (WGS84). */
  lat: number;
  /** Center longitude in degrees (WGS84). */
  lon: number;
  /** Fractional zoom level (0 = whole world in one 256px tile). */
  zoom: number;
}

/** A {@link MapView} plus the device-pixel canvas size it is projected into. */
export interface Viewport extends MapView {
  /** Canvas width in device pixels. */
  width: number;
  /** Canvas height in device pixels. */
  height: number;
}
