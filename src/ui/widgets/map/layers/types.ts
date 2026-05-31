/**
 * Overlay data shapes + the data-accessor seam (task T2.4; spec plan/04 §4.2,
 * §4.3). Layers are driven by **pure, injectable accessors** — a layer never
 * reads a store directly; the Flight screen (T2.11) maps `VehicleState` /
 * `Mission` / fence / rally into these small, decoupled shapes and passes a
 * `() => data` getter. This keeps the layers store-agnostic and unit-testable
 * with plain functions, and lets the M4 plan screens feed real mission/fence/
 * rally data through the same seam later.
 */
import type { LatLon } from './geometry';

/**
 * A reactive-friendly data source: a zero-arg getter returning the current
 * value, or `undefined`/empty when there is nothing to draw. In the app this is
 * a Solid accessor; in tests it is any closure. Layers call it every frame, so
 * it must be cheap and side-effect-free.
 */
export type DataAccessor<T> = () => T | undefined;

/** Live vehicle marker state: position + icon heading + optional course. */
export interface VehicleOverlay {
  lat: number;
  lon: number;
  /** Icon heading, degrees clockwise from north. */
  headingDeg: number;
  /** Course-over-ground for the velocity vector; defaults to `headingDeg`. */
  courseDeg?: number;
}

/** One drawn mission item. `nav` items are linked by the flight-path polyline. */
export interface MissionWaypoint {
  seq: number;
  lat: number;
  lon: number;
  /** Whether this item is a navigational waypoint that joins the flight path. */
  nav?: boolean;
  /** Optional short label (e.g. the command name) for the marker. */
  label?: string;
}

/** Mission overlay scaffold — empty until M4 wires real `MissionClient` data. */
export interface MissionOverlay {
  waypoints: MissionWaypoint[];
}

/** A geofence circle: inclusion (keep-in) or exclusion (keep-out). */
export interface FenceCircle {
  lat: number;
  lon: number;
  radiusM: number;
  /** `true` for an inclusion (keep-in) circle; `false`/absent for exclusion. */
  inclusion?: boolean;
}

/** Geofence overlay scaffold — polygons + circles; empty until M4. */
export interface GeofenceOverlay {
  /** Closed polygon rings (each an ordered list of vertices). */
  polygons: LatLon[][];
  circles: FenceCircle[];
}

/** A single rally point with an optional label. */
export interface RallyPoint {
  lat: number;
  lon: number;
  label?: string;
}

/** Rally-points overlay scaffold — empty until M4. */
export interface RallyOverlay {
  points: RallyPoint[];
}
