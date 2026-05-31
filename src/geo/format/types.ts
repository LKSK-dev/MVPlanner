/**
 * Shared types for `geo/format` (task T3.8; spec plan/05 §5.9). WGS84 geographic
 * coordinates throughout: `lat` ∈ [-90, 90], `lon` ∈ [-180, 180], in degrees.
 */

/** A geographic point in WGS84 decimal degrees. */
export interface LatLon {
  /** Latitude in degrees, north-positive, `[-90, 90]`. */
  lat: number;
  /** Longitude in degrees, east-positive, `[-180, 180]`. */
  lon: number;
}
