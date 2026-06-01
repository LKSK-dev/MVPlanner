/**
 * Pure antenna-tracker pointing math (task T8.9; spec plan/04 §4.12).
 *
 * Given the tracker's ground position and the active vehicle's position, derive
 * the geometric pointing solution: azimuth (compass bearing, 0..360° clockwise
 * from true north), elevation (look-up angle above the horizontal, −90..+90°)
 * and the slant + ground distance. No I/O — trivially unit-testable.
 *
 * The model is a local-tangent-plane approximation: great-circle bearing and
 * haversine ground distance over a spherical Earth, with elevation from the
 * altitude difference over the ground distance. This matches how a tracker aims
 * over the short-to-medium ranges (≤ tens of km) it operates at.
 */

/** Mean Earth radius in metres (spherical model). */
const EARTH_RADIUS_M = 6_371_000;

const DEG_PER_RAD = 180 / Math.PI;
const RAD_PER_DEG = Math.PI / 180;

/** A geographic point with altitude above mean sea level (metres). */
export interface GeoPoint {
  /** Latitude in degrees (−90..90). */
  readonly lat: number;
  /** Longitude in degrees (−180..180). */
  readonly lon: number;
  /** Altitude above mean sea level in metres. */
  readonly altM: number;
}

/** The geometric pointing solution from a tracker toward a target. */
export interface Pointing {
  /** Compass bearing to the target, degrees clockwise from true north (0..360). */
  readonly azimuthDeg: number;
  /** Look-up angle above horizontal, degrees (−90..90). */
  readonly elevationDeg: number;
  /** Straight-line (slant) distance to the target, metres. */
  readonly distanceM: number;
  /** Horizontal ground distance to the target, metres. */
  readonly groundDistanceM: number;
}

/** Normalise an angle in degrees into the [0, 360) range. */
export function normalizeAzimuthDeg(deg: number): number {
  const wrapped = deg % 360;
  // `|| 0` collapses a `-0` result (e.g. `-360 % 360`) to a positive zero.
  return (wrapped < 0 ? wrapped + 360 : wrapped) || 0;
}

/**
 * Great-circle initial bearing from `from` to `to`, degrees clockwise from true
 * north (0..360). Returns `0` when the two points are coincident in lat/lon.
 */
export function bearingDeg(from: GeoPoint, to: GeoPoint): number {
  const φ1 = from.lat * RAD_PER_DEG;
  const φ2 = to.lat * RAD_PER_DEG;
  const Δλ = (to.lon - from.lon) * RAD_PER_DEG;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  if (x === 0 && y === 0) return 0;
  return normalizeAzimuthDeg(Math.atan2(y, x) * DEG_PER_RAD);
}

/** Haversine ground distance between two points (ignores altitude), metres. */
export function groundDistanceM(from: GeoPoint, to: GeoPoint): number {
  const φ1 = from.lat * RAD_PER_DEG;
  const φ2 = to.lat * RAD_PER_DEG;
  const Δφ = (to.lat - from.lat) * RAD_PER_DEG;
  const Δλ = (to.lon - from.lon) * RAD_PER_DEG;
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

/**
 * Full pointing solution from `tracker` toward `vehicle`.
 *
 * Elevation is `atan2(Δalt, groundDistance)`; when the points are coincident in
 * lat/lon the elevation collapses to ±90° (straight up/down) or 0° if the
 * altitudes are equal too, and the azimuth is reported as `0`.
 */
export function computePointing(tracker: GeoPoint, vehicle: GeoPoint): Pointing {
  const ground = groundDistanceM(tracker, vehicle);
  const dAlt = vehicle.altM - tracker.altM;
  const azimuthDeg = bearingDeg(tracker, vehicle);
  const elevationDeg = Math.atan2(dAlt, ground) * DEG_PER_RAD;
  const distanceM = Math.sqrt(ground * ground + dAlt * dAlt);
  return { azimuthDeg, elevationDeg, distanceM, groundDistanceM: ground };
}
