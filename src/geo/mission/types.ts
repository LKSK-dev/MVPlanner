/**
 * Shared types for the mission editing model (task T4.2; spec plan/04 §4.3).
 *
 * The model is a mutable-friendly, *editing-oriented* view that sits on top of
 * the FROZEN wire {@link import('../../contracts').MissionItem} /
 * {@link import('../../contracts').Mission} contracts. Where the wire type stores
 * geographic position as scaled integers (`x`/`y` = degrees × 1e7, as in
 * `MISSION_ITEM_INT`), the model stores plain WGS84 **degrees** so table/map
 * editors never juggle the scale factor (mapping lives in `./convert`).
 *
 * All model helpers are pure: they return a new {@link MissionModel} rather than
 * mutating in place, which keeps them trivially testable and fits the reactive
 * store consumers (waypoint table T4.3, map editing T4.4).
 */
import type { MissionType } from '../../contracts';

export type { MissionType } from '../../contracts';

/**
 * Semantic altitude frame, decoupled from the raw `MAV_FRAME` number.
 *
 * - `relative` → altitude above the home/launch point.
 * - `amsl` → altitude above mean sea level.
 * - `terrain` → altitude above the terrain at the waypoint.
 *
 * See `./frames` for the `MAV_FRAME` ↔ {@link AltFrame} mapping.
 */
export type AltFrame = 'relative' | 'amsl' | 'terrain';

/**
 * One editable mission command.
 *
 * `params` is `param1..param4`; `lat`/`lon`/`alt` correspond to the wire item's
 * `x`/`y`/`z`. For position-bearing NAV commands `lat`/`lon` are real WGS84
 * degrees; for the many `DO_*`/`CONDITION_*` commands that ignore position they
 * are typically `0` (and round-trip as such).
 */
export interface MissionItemModel {
  /** `MAV_CMD` command id (e.g. 16 = `NAV_WAYPOINT`). */
  command: number;
  /** `MAV_FRAME` value (e.g. 6 = `GLOBAL_RELATIVE_ALT_INT`). */
  frame: number;
  /** `param1..param4`. */
  params: readonly [number, number, number, number];
  /** Latitude in WGS84 degrees (wire `x` = `round(lat × 1e7)`). */
  lat: number;
  /** Longitude in WGS84 degrees (wire `y` = `round(lon × 1e7)`). */
  lon: number;
  /** Altitude / `z` value (metres for global frames). */
  alt: number;
  /** `autocontinue` flag (advance to the next item automatically). */
  autocontinue: boolean;
}

/**
 * The editable mission: an ordered list of {@link MissionItemModel} plus the
 * defaults applied to newly created waypoints and the active-item pointer.
 */
export interface MissionModel {
  /** Which list this is (`mission` / `fence` / `rally`). */
  type: MissionType;
  /** Ordered command list; the array index is the wire `seq`. */
  items: readonly MissionItemModel[];
  /** Default altitude (metres) for new waypoints. */
  defaultAlt: number;
  /** Default `MAV_FRAME` for new waypoints. */
  defaultFrame: number;
  /** Index of the current/active item (wire `current = 1`); `0` by default. */
  currentSeq: number;
}

/** Rough mission estimates (spec plan/04 §4.3 "total distance/time estimates"). */
export interface MissionEstimate {
  /** Total great-circle ground distance over position waypoints, metres. */
  distanceM: number;
  /** Rough flight time = {@link distanceM} ÷ cruise speed, seconds. */
  timeS: number;
  /** Number of position-bearing waypoints that contribute to the path. */
  waypointCount: number;
}
