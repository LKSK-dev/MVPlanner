/**
 * Public types for mission file I/O (task T4.9; spec plan/04 §4.3, plan/07
 * §7.6).
 *
 * The on-disk formats this module reads/writes are:
 *
 *  - **`QGC WPL 110`** — the ArduPilot / Mission Planner `.waypoints`/`.txt`
 *    tab-separated text format (mission items only).
 *  - **QGroundControl `.plan`** — a JSON document carrying the mission plus an
 *    optional geofence, rally points and planned home position.
 *  - **KML** / **GPX** — imported (read-only) into a simple waypoint mission.
 *
 * A {@link import('../../contracts').Mission} is the common in-memory shape; the
 * richer `.plan` structure is modelled by {@link PlanFile}.
 */
import type { Mission } from '../../contracts';

/** The mission file formats this module recognises. */
export type MissionFileFormat = 'wpl' | 'plan' | 'kml' | 'gpx';

/** The formats this module can write back to disk (KML/GPX are import-only). */
export type MissionSaveFormat = 'wpl' | 'plan';

/** A `[latitude, longitude]` pair in decimal degrees. */
export type LatLon = readonly [lat: number, lon: number];

/** A `[latitude, longitude, altitude]` triple (degrees, degrees, metres). */
export type LatLonAlt = readonly [lat: number, lon: number, alt: number];

/** A geofence circle (inclusion keeps the vehicle inside; exclusion keeps it out). */
export interface PlanFenceCircle {
  /** `true` for an inclusion circle, `false` for an exclusion circle. */
  readonly inclusion: boolean;
  /** Circle centre in decimal degrees. */
  readonly center: LatLon;
  /** Radius in metres. */
  readonly radius: number;
}

/** A geofence polygon. */
export interface PlanFencePolygon {
  /** `true` for an inclusion polygon, `false` for an exclusion polygon. */
  readonly inclusion: boolean;
  /** Ordered vertices in decimal degrees. */
  readonly polygon: readonly LatLon[];
}

/** The geofence section of a `.plan` (`geoFence`). */
export interface PlanFence {
  readonly circles: readonly PlanFenceCircle[];
  readonly polygons: readonly PlanFencePolygon[];
}

/** The rally-points section of a `.plan` (`rallyPoints`). */
export interface PlanRally {
  /** Rally points as `[lat, lon, alt]` triples. */
  readonly points: readonly LatLonAlt[];
}

/**
 * A parsed QGroundControl `.plan` document. Captures the full structure so a
 * parse → serialize round-trip preserves mission, fence, rally and metadata.
 */
export interface PlanFile {
  /** `groundStation` field (informational; defaults to `MVPlanner`). */
  readonly groundStation: string;
  /** `mission.firmwareType` (`MAV_AUTOPILOT`). */
  readonly firmwareType: number;
  /** `mission.vehicleType` (`MAV_TYPE`). */
  readonly vehicleType: number;
  /** `mission.cruiseSpeed` in m/s. */
  readonly cruiseSpeed: number;
  /** `mission.hoverSpeed` in m/s. */
  readonly hoverSpeed: number;
  /** `mission.plannedHomePosition` as `[lat, lon, alt]`. */
  readonly plannedHomePosition: LatLonAlt;
  /** The mission items (`mission.items`, all `SimpleItem`). */
  readonly mission: Mission;
  /** The geofence (`geoFence`). */
  readonly fence: PlanFence;
  /** The rally points (`rallyPoints`). */
  readonly rally: PlanRally;
}

/** The result of loading a mission file from disk. */
export interface LoadedMission {
  /** File name reported by the picker (e.g. `survey.plan`). */
  readonly name: string;
  /** The detected format. */
  readonly format: MissionFileFormat;
  /** The primary mission items (for every format). */
  readonly mission: Mission;
  /** The full `.plan` structure — present only when `format === 'plan'`. */
  readonly plan?: PlanFile;
}

/** Options for KML/GPX import. */
export interface ImportOptions {
  /**
   * Altitude (metres) assigned to imported waypoints that carry no elevation.
   * Defaults to `0`.
   */
  readonly defaultAlt?: number;
}
