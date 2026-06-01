/**
 * Pure planar geometry helpers for `geo/survey` (task T4.5; spec plan/04 §4.3).
 *
 * Survey areas are small enough that a local **equirectangular tangent-plane**
 * projection (centred on the polygon) is accurate to well under a metre, which
 * keeps the grid math simple and fully testable. All planar coordinates are in
 * **metres** east (`x`) / north (`y`) of the projection origin.
 */
import type { LatLon } from '../format';

/** WGS84 mean Earth radius (metres) used for the local tangent plane. */
const EARTH_RADIUS_M = 6378137;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

/** A planar point in metres (`x` = east, `y` = north of the origin). */
export interface PlanarPoint {
  x: number;
  y: number;
}

/** Arithmetic mean of the polygon vertices — the projection origin. */
export function polygonCentroid(polygon: readonly LatLon[]): LatLon {
  let lat = 0;
  let lon = 0;
  for (const p of polygon) {
    lat += p.lat;
    lon += p.lon;
  }
  const n = polygon.length || 1;
  return { lat: lat / n, lon: lon / n };
}

/** Project `p` onto the local tangent plane centred at `origin`. */
export function toPlanar(p: LatLon, origin: LatLon): PlanarPoint {
  const x = EARTH_RADIUS_M * (p.lon - origin.lon) * DEG_TO_RAD * Math.cos(origin.lat * DEG_TO_RAD);
  const y = EARTH_RADIUS_M * (p.lat - origin.lat) * DEG_TO_RAD;
  return { x, y };
}

/** Inverse of {@link toPlanar}: map a planar point back to WGS84. */
export function toLatLon(pt: PlanarPoint, origin: LatLon): LatLon {
  const lat = origin.lat + (pt.y / EARTH_RADIUS_M) * RAD_TO_DEG;
  const lon =
    origin.lon + (pt.x / (EARTH_RADIUS_M * Math.cos(origin.lat * DEG_TO_RAD))) * RAD_TO_DEG;
  return { lat, lon };
}

/** Signed-area magnitude (shoelace) of a planar polygon, square metres. */
export function polygonAreaM2(poly: readonly PlanarPoint[]): number {
  const n = poly.length;
  if (n < 3) return 0;
  let twice = 0;
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (a === undefined || b === undefined) continue;
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

/** Euclidean distance between two planar points, metres. */
export function distance(a: PlanarPoint, b: PlanarPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Map an `(u, v)` coordinate in the {along, across} basis back to planar XY. */
export function uvToPlanar(
  u: number,
  v: number,
  along: PlanarPoint,
  across: PlanarPoint,
): PlanarPoint {
  return { x: u * along.x + v * across.x, y: u * along.y + v * across.y };
}

/**
 * Intersect the scan line at across-coordinate `vLine` with `poly`, returning
 * the covered `[uLo, uHi]` segments along the flight direction.
 *
 * `along`/`across` are the orthonormal flight-direction / perpendicular unit
 * vectors. A half-open crossing rule (`v ∈ [edgeMin, edgeMax)`) is used so a
 * shared vertex is counted once, which keeps the crossing count even for any
 * simple polygon — including non-convex shapes (yielding multiple segments).
 */
export function scanLineSegments(
  poly: readonly PlanarPoint[],
  along: PlanarPoint,
  across: PlanarPoint,
  vLine: number,
): Array<{ uLo: number; uHi: number }> {
  const n = poly.length;
  const crossings: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    if (a === undefined || b === undefined) continue;
    const va = a.x * across.x + a.y * across.y;
    const vb = b.x * across.x + b.y * across.y;
    const crosses = (va <= vLine && vb > vLine) || (vb <= vLine && va > vLine);
    if (!crosses) continue;
    const t = (vLine - va) / (vb - va);
    const ua = a.x * along.x + a.y * along.y;
    const ub = b.x * along.x + b.y * along.y;
    crossings.push(ua + t * (ub - ua));
  }
  crossings.sort((p, q) => p - q);
  const segments: Array<{ uLo: number; uHi: number }> = [];
  for (let i = 0; i + 1 < crossings.length; i += 2) {
    const uLo = crossings[i];
    const uHi = crossings[i + 1];
    if (uLo === undefined || uHi === undefined) continue;
    segments.push({ uLo, uHi });
  }
  return segments;
}
