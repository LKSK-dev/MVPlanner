/**
 * Shared types for the rally-points model (task T4.7; spec plan/04 §4.3 rally).
 *
 * A {@link Rally} is an editing-oriented view that sits on top of the FROZEN
 * wire {@link import('../../contracts').Mission} /
 * {@link import('../../contracts').MissionItem} contracts for
 * `MISSION_TYPE_RALLY`. Where the wire item stores geographic position as scaled
 * integers (`x`/`y` = degrees × 1e7, as in `MISSION_ITEM_INT`), the model stores
 * plain WGS84 **degrees** so the editor never juggles the scale factor (the
 * mapping lives in `./convert`).
 *
 * All linear quantities are **metres**, headings are **degrees** and identifiers
 * carry their unit per the coding standards (conventions
 * plan/implementation/00 §0.3). Model helpers are pure — they return a new
 * {@link Rally} rather than mutating in place.
 */
import type { LatLon } from '../format';

export type { LatLon } from '../format';

/**
 * A single rally point: a safe return/loiter location the vehicle can divert to
 * (ArduPilot rally point / `MAV_CMD_NAV_RALLY_POINT`).
 *
 * `lat`/`lon` are WGS84 degrees (wire `x`/`y` = `round(deg × 1e7)`); `alt` is the
 * rally altitude in metres in the model's relative-alt frame. The optional
 * fields mirror the ArduPilot `RALLY_POINT` message extras and round-trip through
 * the mission-item params (see `./convert`).
 */
export interface RallyPoint {
  /** Latitude in WGS84 degrees. */
  lat: number;
  /** Longitude in WGS84 degrees. */
  lon: number;
  /** Rally altitude, metres (relative-alt frame). */
  alt: number;
  /** Optional break altitude (metres) at which to begin the landing sequence. */
  breakAlt?: number;
  /** Optional desired landing heading, degrees (ArduPilot `land_dir`). */
  landDir?: number;
  /** Optional `RALLY_FLAGS` bitmask (see `RALLY_FLAG_*` in `./convert`). */
  flags?: number;
}

/**
 * The editable rally set: an ordered list of {@link RallyPoint} plus the default
 * altitude applied to newly created points.
 */
export interface Rally {
  /** Ordered rally points; the array index is the wire `seq`. */
  points: readonly RallyPoint[];
  /** Default altitude (metres) for new rally points. */
  defaultAlt: number;
}

/** A bare {@link LatLon} re-export alias for editor call sites. */
export type RallyLatLon = LatLon;
