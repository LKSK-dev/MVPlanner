/**
 * Pure Web-Mercator (EPSG:3857) slippy-map math (task T2.3; spec plan/02 §2.5,
 * plan/04 §4.2 map, plan/07 §7.2). No DOM, no globals — every function here is
 * deterministic and unit-tested ({@link file://./../../../test/unit/tiles-mercator.test.ts}).
 *
 * Conventions:
 * - Longitude/latitude are WGS84 degrees; latitude is clamped to the Mercator
 *   limit ({@link MAX_MERCATOR_LAT}) before projection.
 * - "World pixels" at zoom `z` span `[0, 256·2^z)` with the origin at the
 *   top-left (north-west); `x` increases east, `y` increases south — the slippy
 *   map convention used by XYZ tile servers.
 */
import type { TileCoord } from './types';

/** Edge length of a single tile, in pixels (the slippy-map standard). */
export const TILE_SIZE = 256;

/** Maximum latitude representable in Web-Mercator (where `y` would be ±∞). */
export const MAX_MERCATOR_LAT = 85.05112877980659;

/** Half the EPSG:3857 world extent, in metres (the projected ±180°/±85.05°). */
export const MERCATOR_EXTENT = 20037508.342789244;

/** Clamp `n` into the inclusive range `[lo, hi]`. */
export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(n, hi));
}

/** Wrap a (possibly negative or out-of-range) tile column into `[0, n)`. */
export function wrapTileX(x: number, n: number): number {
  return ((Math.trunc(x) % n) + n) % n;
}

/** Clamp a latitude to the Web-Mercator projectable range. */
export function clampLat(lat: number): number {
  return clamp(lat, -MAX_MERCATOR_LAT, MAX_MERCATOR_LAT);
}

/** The world size (in pixels) at zoom `z`: `256·2^z`. */
export function worldSize(z: number): number {
  return TILE_SIZE * 2 ** z;
}

/**
 * Project a geographic coordinate to world pixels at zoom `z`.
 *
 * `x = (lon+180)/360 · 256·2^z`,
 * `y = (1 − ln(tan φ + sec φ)/π)/2 · 256·2^z` (φ in radians).
 *
 * @returns `[x, y]` world pixels (origin top-left / north-west).
 */
export function lonLatToWorld(lon: number, lat: number, z: number): [number, number] {
  const size = worldSize(z);
  const x = ((lon + 180) / 360) * size;
  const latRad = (clampLat(lat) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * size;
  return [x, y];
}

/**
 * Inverse of {@link lonLatToWorld}: world pixels at zoom `z` back to lon/lat.
 * Used for click → geographic coordinate hit-testing.
 *
 * @returns `[lon, lat]` degrees.
 */
export function worldToLonLat(x: number, y: number, z: number): [number, number] {
  const size = worldSize(z);
  const lon = (x / size) * 360 - 180;
  const n = Math.PI * (1 - (2 * y) / size);
  const lat = (Math.atan(Math.sinh(n)) * 180) / Math.PI;
  return [lon, lat];
}

/**
 * The integer XYZ tile containing `lon`/`lat` at integer zoom `z`. The column is
 * wrapped into `[0, 2^z)` and the row is clamped to the valid range.
 */
export function lonLatToTile(lon: number, lat: number, z: number): TileCoord {
  const [x, y] = lonLatToWorld(lon, lat, z);
  const n = 2 ** z;
  const tx = Math.floor(x / TILE_SIZE);
  const ty = Math.floor(y / TILE_SIZE);
  return { z, x: wrapTileX(tx, n), y: clamp(ty, 0, n - 1) };
}

/**
 * The EPSG:3857 extent of a tile, in metres, as `[minX, minY, maxX, maxY]`
 * (west, south, east, north). Used to build WMS `BBOX` requests.
 */
export function tileExtent3857(tile: TileCoord): [number, number, number, number] {
  const n = 2 ** tile.z;
  const span = (2 * MERCATOR_EXTENT) / n;
  const minX = -MERCATOR_EXTENT + tile.x * span;
  const maxX = minX + span;
  const maxY = MERCATOR_EXTENT - tile.y * span;
  const minY = maxY - span;
  return [minX, minY, maxX, maxY];
}
