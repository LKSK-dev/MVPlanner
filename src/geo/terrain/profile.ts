/**
 * Pure terrain-profile geometry (task T4.8; spec plan/04 §4.3 "sample elevation
 * along the path, show terrain profile chart, warn on collisions, support
 * terrain-frame altitudes"). No DOM, no network — every function here is
 * deterministic and unit-tested. The async elevation sampling that feeds these
 * lives in {@link file://./provider.ts}.
 */
import type { LatLon } from '../format';

/** Mean Earth radius (IUGG), metres — matches `geo/mission` great-circle math. */
export const EARTH_RADIUS_M = 6371008.8;

/** Metres per degree of latitude at the Earth's mean radius. */
export const M_PER_DEG_LAT = (EARTH_RADIUS_M * Math.PI) / 180;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle (haversine) distance between two WGS84 points, in metres. */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Offset `origin` by `northM` metres north and `eastM` metres east, returning a
 * new WGS84 point (equirectangular approximation — accurate over the short spans
 * used for terrain-grid sampling). Longitude scaling uses the origin latitude.
 */
export function offsetLatLon(origin: LatLon, northM: number, eastM: number): LatLon {
  const dLat = northM / M_PER_DEG_LAT;
  const cosLat = Math.cos(toRadians(origin.lat));
  const dLon = cosLat !== 0 ? eastM / (M_PER_DEG_LAT * cosLat) : 0;
  return { lat: origin.lat + dLat, lon: origin.lon + dLon };
}

/** A point along the path at which to sample terrain: its position + chainage. */
export interface PathSample {
  /** Sample position (WGS84). */
  readonly at: LatLon;
  /** Cumulative ground distance from the path start, metres. */
  readonly distanceM: number;
}

/**
 * Densify a polyline into evenly-spaced sample points (≈ `spacingM` apart) plus
 * the original vertices' chainage, so a terrain profile has a regular x-axis.
 * Always includes the first and last vertices. Intermediate points are linearly
 * interpolated in lat/lon (sufficient for the short steps of a profile). A
 * degenerate path (`< 2` points, or zero length) yields just its vertices.
 */
export function samplePath(points: readonly LatLon[], spacingM: number): PathSample[] {
  if (points.length === 0) return [];
  const first = points[0];
  if (first === undefined) return [];
  if (points.length === 1) return [{ at: first, distanceM: 0 }];

  // Cumulative chainage at each vertex.
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    const prevCum = cum[i - 1] ?? 0;
    const seg = prev !== undefined && cur !== undefined ? haversineMeters(prev, cur) : 0;
    cum.push(prevCum + seg);
  }
  const total = cum[cum.length - 1] ?? 0;
  if (total <= 0) return [{ at: first, distanceM: 0 }];

  const step = spacingM > 0 ? spacingM : total;
  const out: PathSample[] = [];
  let seg = 0;
  for (let d = 0; d < total; d += step) {
    while (seg < cum.length - 1 && (cum[seg + 1] ?? total) < d) seg++;
    out.push({ at: interpolateAt(points, cum, seg, d), distanceM: d });
  }
  const last = points[points.length - 1];
  if (last !== undefined) out.push({ at: last, distanceM: total });
  return out;
}

/** Linearly interpolate the position at chainage `d` within segment `seg`. */
function interpolateAt(
  points: readonly LatLon[],
  cum: readonly number[],
  seg: number,
  d: number,
): LatLon {
  const a = points[seg];
  const b = points[seg + 1];
  const ca = cum[seg] ?? 0;
  const cb = cum[seg + 1] ?? ca;
  if (a === undefined) return b ?? { lat: 0, lon: 0 };
  if (b === undefined) return a;
  const span = cb - ca;
  const f = span > 0 ? Math.max(0, Math.min(1, (d - ca) / span)) : 0;
  return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
}

/** One terrain-profile sample: ground elevation (AMSL) at a chainage. */
export interface ElevationSample {
  /** Cumulative ground distance from the path start, metres. */
  readonly distanceM: number;
  /** Ground elevation above sea level, metres; `undefined` when unavailable. */
  readonly elevationM: number | undefined;
}

/**
 * A profile point for the chart / collision check: the ground elevation plus the
 * optional planned path altitude (both AMSL) at the same chainage.
 */
export interface TerrainProfilePoint {
  /** Cumulative ground distance from the path start, metres. */
  readonly distanceM: number;
  /** Ground elevation above sea level, metres. */
  readonly terrainM: number;
  /** Planned path altitude above sea level, metres; omit where the path has none. */
  readonly plannedAmslM?: number;
}

/** A flagged terrain-collision / low-clearance point along the path. */
export interface CollisionMarker {
  /** Cumulative ground distance from the path start, metres. */
  readonly distanceM: number;
  /** Ground elevation (AMSL) at the point, metres. */
  readonly terrainM: number;
  /** Planned path altitude (AMSL) at the point, metres. */
  readonly plannedAmslM: number;
  /** `plannedAmslM − terrainM`; negative = below ground, `< minClearance` = warn. */
  readonly clearanceM: number;
}

/**
 * Convert a terrain-frame (AGL) altitude to AMSL given the ground elevation:
 * `amsl = agl + terrain`. Used when the mission's altitude frame is "terrain".
 */
export function aglToAmsl(aglM: number, terrainM: number): number {
  return aglM + terrainM;
}

/** Inverse of {@link aglToAmsl}: AMSL altitude to height above ground. */
export function amslToAgl(amslM: number, terrainM: number): number {
  return amslM - terrainM;
}

/**
 * Flag every profile point whose planned altitude is within `minClearanceM` of
 * (or below) the terrain. Points without a planned altitude are skipped. The
 * returned markers carry the signed clearance so the UI can colour severity.
 */
export function collisionCheck(
  points: readonly TerrainProfilePoint[],
  minClearanceM: number,
): CollisionMarker[] {
  const markers: CollisionMarker[] = [];
  for (const p of points) {
    if (p.plannedAmslM === undefined) continue;
    const clearanceM = p.plannedAmslM - p.terrainM;
    if (clearanceM < minClearanceM) {
      markers.push({
        distanceM: p.distanceM,
        terrainM: p.terrainM,
        plannedAmslM: p.plannedAmslM,
        clearanceM,
      });
    }
  }
  return markers;
}
