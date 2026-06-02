/**
 * Pure overlay geometry for the map layers + tools (task T2.4; spec plan/04
 * §4.2 map, §4.3 plan geometry). Everything here is deterministic and
 * dependency-free — no DOM, no globals, no canvas. It is the unit-tested core
 * of the overlays: the vehicle icon transform, the heading vector, live-track
 * decimation, great-circle distance, spherical polygon area and the
 * `project()`-driven screen mapping. The imperative `<canvas>` draw lives in
 * `./draw` and is happy-dom-deferred; this module is what the tests assert.
 *
 * Conventions:
 * - Geographic points are WGS84 degrees ({@link LatLon}).
 * - A {@link Project} is the engine's `MapRenderCtx.project(lat, lon) → [x, y]`
 *   (device-pixel canvas point). Layers receive it each frame; the geometry
 *   here only ever consumes it, so a stub `project()` fully exercises the path.
 * - Headings are degrees clockwise from north; screen `y` increases downward,
 *   so a north-up shape at heading 0 points to `-y`.
 */

/** A WGS84 geographic point in degrees. */
export interface LatLon {
  lat: number;
  lon: number;
}

/** A device-pixel canvas point `[x, y]` (origin top-left). */
export type ScreenPoint = [number, number];

/** The engine's projection: a coordinate → a device-pixel canvas point. */
export type Project = (lat: number, lon: number) => ScreenPoint;

/** Mean Earth radius (IUGG), metres — used for great-circle distance/area. */
export const EARTH_RADIUS_M = 6371008.8;

/** Approximate metres per degree of latitude (used for radius→pixel scaling). */
export const METERS_PER_DEG_LAT = 111_320;

/** Degrees → radians. */
export function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Great-circle (haversine) distance between two coordinates, in metres.
 * Symmetric and numerically stable for small separations.
 */
export function haversineMeters(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLat = lat2 - lat1;
  const dLon = toRadians(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Running great-circle length of a polyline, in metres (`0` for < 2 points). */
export function pathLengthMeters(points: readonly LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const cur = points[i];
    if (prev && cur) total += haversineMeters(prev, cur);
  }
  return total;
}

/**
 * Area of a closed spherical polygon, in square metres (`0` for < 3 points).
 * Uses the standard spherical-excess line-integral approximation (the same one
 * Leaflet/Turf use); the ring is treated as implicitly closed and the result is
 * orientation-independent (absolute value).
 */
export function polygonAreaMeters2(points: readonly LatLon[]): number {
  const n = points.length;
  if (n < 3) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const p1 = points[i];
    const p2 = points[(i + 1) % n];
    if (!p1 || !p2) continue;
    sum +=
      toRadians(p2.lon - p1.lon) * (2 + Math.sin(toRadians(p1.lat)) + Math.sin(toRadians(p2.lat)));
  }
  return Math.abs((sum * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

/**
 * Project a list of coordinates to screen points via the engine `project()`.
 * This is the single place layers turn geographic geometry into canvas pixels,
 * so spying on `project` proves a layer's "screen projection usage".
 */
export function projectPath(points: readonly LatLon[], project: Project): ScreenPoint[] {
  return points.map((p) => project(p.lat, p.lon));
}

/**
 * The vehicle marker polygon: a north-up arrow (nose, two tails, a centre
 * notch) centred at `center`, scaled to `sizePx` and rotated to `headingDeg`
 * (clockwise from north, in screen space where `y` is down). Returns the rotated
 * device-pixel vertices ready to stroke/fill.
 */
export function vehicleIconPolygon(
  center: ScreenPoint,
  headingDeg: number,
  sizePx: number,
): ScreenPoint[] {
  const half = sizePx / 2;
  // Local arrow in a north-up frame (nose at -y); clockwise winding.
  const local: ScreenPoint[] = [
    [0, -half], // nose
    [half * 0.6, half], // right tail
    [0, half * 0.45], // centre notch
    [-half * 0.6, half], // left tail
  ];
  return local.map((p) => rotateAbout(center, p, headingDeg));
}

/**
 * The end point of the heading/course vector: a segment of `lengthPx` starting
 * at `center` and pointing along `headingDeg` (clockwise from north).
 */
export function headingVectorEnd(
  center: ScreenPoint,
  headingDeg: number,
  lengthPx: number,
): ScreenPoint {
  return rotateAbout(center, [0, -lengthPx], headingDeg);
}

/**
 * Rotate a local offset `[x, y]` clockwise by `deg` (north-up, screen `y` down)
 * and translate it onto `center`. Internal helper shared by the icon + vector.
 */
function rotateAbout(center: ScreenPoint, offset: ScreenPoint, deg: number): ScreenPoint {
  const a = toRadians(deg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const [x, y] = offset;
  return [center[0] + x * cos - y * sin, center[1] + x * sin + y * cos];
}

/**
 * The pixel radius of a geographic circle of `radiusM` around `center`, using
 * the live `project()` so it tracks the current zoom. Projects the centre and a
 * point `radiusM` due north and measures the screen gap — a pure `project()`
 * usage (so it is unit-testable with a stub projection).
 */
export function radiusToPixels(center: LatLon, radiusM: number, project: Project): number {
  const dLat = radiusM / METERS_PER_DEG_LAT;
  const c = project(center.lat, center.lon);
  const edge = project(center.lat + dLat, center.lon);
  return Math.hypot(edge[0] - c[0], edge[1] - c[1]);
}

/**
 * Decimate a track to the endpoints plus interior points at least `minSpacingM`
 * apart, preserving order. Keeps the live-track polyline cheap to draw while
 * always retaining the first (oldest) and last (current) positions. Pure: it
 * never mutates the input.
 */
export function decimateTrack(points: readonly LatLon[], minSpacingM: number): LatLon[] {
  if (points.length <= 2 || minSpacingM <= 0) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return points.slice();
  const out: LatLon[] = [first];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const kept = out[out.length - 1];
    if (p && kept && haversineMeters(kept, p) >= minSpacingM) out.push(p);
  }
  out.push(last);
  return out;
}

/**
 * Length system for the measure readouts. Additive over the historical
 * metric-only helpers; the screens map the resolved app units onto this token
 * so the Measure tool honours the selected units.
 */
export type MeasureSystem = 'metric' | 'imperial';

/** Metres per international foot (exact). */
const M_PER_FOOT = 0.3048;
/** Feet in a statute mile. */
const FEET_PER_MILE = 5280;
/** Square metres in a square statute mile (`5280 ft` squared). */
const M2_PER_SQ_MILE = (FEET_PER_MILE * M_PER_FOOT) ** 2;

/**
 * Format a metre distance as a short string. Defaults to metric
 * (`"456 m"` / `"1.23 km"`); pass `'imperial'` to render feet/miles
 * (`"1497 ft"` / `"1.23 mi"`). The default keeps every existing caller (and
 * test) unchanged.
 */
export function formatDistanceM(meters: number, system: MeasureSystem = 'metric'): string {
  if (system === 'imperial') {
    if (!Number.isFinite(meters) || meters <= 0) return '0 ft';
    const feet = meters / M_PER_FOOT;
    if (feet >= FEET_PER_MILE) return `${(feet / FEET_PER_MILE).toFixed(2)} mi`;
    return feet < 10 ? `${feet.toFixed(1)} ft` : `${Math.round(feet)} ft`;
  }
  if (!Number.isFinite(meters) || meters <= 0) return '0 m';
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return meters < 10 ? `${meters.toFixed(1)} m` : `${Math.round(meters)} m`;
}

/**
 * Format a square-metre area as a short string. Defaults to metric
 * (`"456 m²"` / `"1.23 km²"`); pass `'imperial'` to render square feet/miles
 * (`"4908 ft²"` / `"1.23 mi²"`). The default keeps existing callers unchanged.
 */
export function formatAreaM2(area: number, system: MeasureSystem = 'metric'): string {
  if (system === 'imperial') {
    if (!Number.isFinite(area) || area <= 0) return '0 ft\u00b2';
    if (area >= M2_PER_SQ_MILE) return `${(area / M2_PER_SQ_MILE).toFixed(2)} mi\u00b2`;
    return `${Math.round(area / (M_PER_FOOT * M_PER_FOOT))} ft\u00b2`;
  }
  if (!Number.isFinite(area) || area <= 0) return '0 m\u00b2';
  if (area >= 1_000_000) return `${(area / 1_000_000).toFixed(2)} km\u00b2`;
  return `${Math.round(area)} m\u00b2`;
}
