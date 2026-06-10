/**
 * Pure viewport ↔ screen math for the raster map engine (task T2.3; spec
 * plan/04 §4.2). Bridges the {@link MapView} camera and a device-pixel canvas:
 * project a coordinate to a canvas pixel, invert a click pixel back to lon/lat,
 * and enumerate the tiles that cover the current viewport. All functions are
 * deterministic and unit-tested; nothing here touches the DOM.
 *
 * Pixels are device pixels with the origin at the canvas top-left.
 */
import {
  TILE_SIZE,
  clamp,
  lonLatToTile,
  lonLatToWorld,
  wrapTileX,
  worldSize,
  worldToLonLat,
} from './mercator';
import type { Bbox } from '../../contracts';
import type { MapView, TileCoord, Viewport } from './types';

/**
 * Project a geographic coordinate to a canvas pixel for the given viewport.
 * The viewport center maps to the canvas center. This is exactly the function
 * exposed to map layers as {@link MapRenderCtx.project} (note the `lat, lon`
 * argument order, matching the frozen contract).
 */
export function projectToScreen(lat: number, lon: number, vp: Viewport): [number, number] {
  const [wx, wy] = lonLatToWorld(lon, lat, vp.zoom);
  const [cx, cy] = lonLatToWorld(vp.lon, vp.lat, vp.zoom);
  const size = worldSize(vp.zoom);
  const dx = wrapWorldDelta(wx - cx, size);
  return [dx + vp.width / 2, wy - cy + vp.height / 2];
}

/** Wrap a horizontal world-pixel delta into the nearest antimeridian image. */
function wrapWorldDelta(dx: number, size: number): number {
  return ((((dx + size / 2) % size) + size) % size) - size / 2;
}

/**
 * Inverse of {@link projectToScreen}: a canvas pixel back to a geographic
 * coordinate. Used to turn a pointer click into `{ lat, lon }`.
 */
export function unprojectScreen(
  px: number,
  py: number,
  vp: Viewport,
): { lat: number; lon: number } {
  const [cx, cy] = lonLatToWorld(vp.lon, vp.lat, vp.zoom);
  const wx = px - vp.width / 2 + cx;
  const wy = py - vp.height / 2 + cy;
  const [rawLon, lat] = worldToLonLat(wx, wy, vp.zoom);
  // Normalize longitude into [-180, 180) so wire encodings (deg ×1e7 int32)
  // never overflow near the antimeridian.
  const lon = ((((rawLon + 180) % 360) + 360) % 360) - 180;
  return { lat, lon };
}

/**
 * The integer tile zoom to fetch for a (possibly fractional) view zoom, clamped
 * to `[min, max]`. Rounding (rather than flooring) keeps tiles closest to 1:1.
 */
export function tileZoomFor(zoom: number, min: number, max: number): number {
  return clamp(Math.round(zoom), min, max);
}

/**
 * The on-canvas rectangle a tile occupies for the given viewport and tile zoom,
 * as `{ x, y, size }` (top-left device pixel + edge length). When the view zoom
 * differs from the tile zoom the tile is scaled by `2^(zoom − tileZoom)`.
 */
export function tileScreenRect(
  tile: TileCoord,
  vp: Viewport,
  tileZoom: number,
): { x: number; y: number; size: number } {
  const scale = 2 ** (vp.zoom - tileZoom);
  const size = TILE_SIZE * scale;
  const [cx, cy] = lonLatToWorld(vp.lon, vp.lat, tileZoom);
  // Wrap the horizontal delta so columns from `visibleTiles` (which wrap
  // around the antimeridian) land on-canvas instead of a world away.
  const dx = wrapWorldDelta(tile.x * TILE_SIZE - cx, worldSize(tileZoom));
  const x = dx * scale + vp.width / 2;
  const y = (tile.y * TILE_SIZE - cy) * scale + vp.height / 2;
  return { x, y, size };
}

/**
 * Enumerate the tiles covering `vp` at `tileZoom`. Columns wrap around the
 * antimeridian; rows are clamped to the valid range (no tiles above/below the
 * Mercator limit). The list is ordered row-major from the north-west corner.
 */
export function visibleTiles(vp: Viewport, tileZoom: number): TileCoord[] {
  const scale = 2 ** (vp.zoom - tileZoom);
  const [cx, cy] = lonLatToWorld(vp.lon, vp.lat, tileZoom);
  const halfW = vp.width / 2 / scale;
  const halfH = vp.height / 2 / scale;
  const minTX = Math.floor((cx - halfW) / TILE_SIZE);
  const maxTX = Math.floor((cx + halfW) / TILE_SIZE);
  const minTY = Math.floor((cy - halfH) / TILE_SIZE);
  const maxTY = Math.floor((cy + halfH) / TILE_SIZE);
  const n = 2 ** tileZoom;
  const out: TileCoord[] = [];
  const columnCount = Math.min(maxTX - minTX + 1, n);
  for (let ty = minTY; ty <= maxTY; ty++) {
    if (ty < 0 || ty >= n) continue;
    for (let i = 0; i < columnCount; i++) {
      out.push({ z: tileZoom, x: wrapTileX(minTX + i, n), y: ty });
    }
  }
  return out;
}

/**
 * Enumerate the tiles intersecting a geographic bounding box at integer zoom
 * `z`. Used by area prefetch. The box must not cross the antimeridian (v1).
 */
export function tilesInBbox(bbox: Bbox, z: number): TileCoord[] {
  const [west, south, east, north] = bbox;
  const nw = lonLatToTile(west, north, z);
  const se = lonLatToTile(east, south, z);
  const n = 2 ** z;
  const out: TileCoord[] = [];
  const minX = Math.min(nw.x, se.x);
  const maxX = Math.max(nw.x, se.x);
  const minY = clamp(Math.min(nw.y, se.y), 0, n - 1);
  const maxY = clamp(Math.max(nw.y, se.y), 0, n - 1);
  for (let ty = minY; ty <= maxY; ty++) {
    for (let tx = minX; tx <= maxX; tx++) {
      out.push({ z, x: wrapTileX(tx, n), y: ty });
    }
  }
  return out;
}

/** Re-export so consumers can build a {@link Viewport} from a {@link MapView}. */
export type { MapView, Viewport };
