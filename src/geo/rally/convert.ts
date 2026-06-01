/**
 * Mapping between the editing {@link Rally} model and the FROZEN wire
 * {@link Mission} / {@link MissionItem} contracts for `MISSION_TYPE_RALLY`
 * (task T4.7; spec plan/04 §4.3 rally). Pure, dependency-free.
 *
 * Each rally point becomes one `MISSION_ITEM_INT`-style item with
 * `command = MAV_CMD_NAV_RALLY_POINT`: position lives in `x`/`y` as
 * degrees × 1e7 and altitude in `z` (metres). ArduPilot's rally protocol carries
 * lat/lng/alt in the item; the optional `RALLY_POINT` extras (break altitude,
 * landing direction, flags) are preserved in `param1..param3` so the model
 * round-trips losslessly.
 */
import type { Mission, MissionItem } from '../../contracts';
import type { Rally, RallyPoint } from './types';

/** `MAV_CMD_NAV_RALLY_POINT` (5100) — define a rally point. */
export const MAV_CMD_NAV_RALLY_POINT = 5100;

/** Degrees ↔ `MISSION_ITEM_INT` `x`/`y` scale factor (1e7). */
export const RALLY_LATLON_SCALE = 1e7;

/**
 * `MAV_FRAME_GLOBAL_RELATIVE_ALT` (3) — rally altitude is relative to home, the
 * frame ArduPilot uses for rally points.
 */
export const DEFAULT_RALLY_FRAME = 3;

/** `RALLY_FLAGS::FAVORABLE_WIND` — pick this rally point when wind is favourable. */
export const RALLY_FLAG_FAVORABLE_WIND = 1;
/** `RALLY_FLAGS::LAND_IMMEDIATELY` — land at this rally point rather than loiter. */
export const RALLY_FLAG_LAND_IMMEDIATELY = 2;

/** Param slot index of the break altitude in a rally `MissionItem`. */
export const PARAM_INDEX_BREAK_ALT = 0;
/** Param slot index of the landing direction in a rally `MissionItem`. */
export const PARAM_INDEX_LAND_DIR = 1;
/** Param slot index of the flags bitmask in a rally `MissionItem`. */
export const PARAM_INDEX_FLAGS = 2;

/** Degrees → scaled `MISSION_ITEM_INT` integer. */
export function degToScaled(deg: number): number {
  return Math.round(deg * RALLY_LATLON_SCALE);
}

/** Scaled `MISSION_ITEM_INT` integer → degrees. */
export function scaledToDeg(scaled: number): number {
  return scaled / RALLY_LATLON_SCALE;
}

/**
 * Convert one {@link RallyPoint} to a wire {@link MissionItem}.
 *
 * @param seq - The item's `seq` (its index in the list).
 */
export function rallyPointToItem(point: RallyPoint, seq: number): MissionItem {
  return {
    seq,
    frame: DEFAULT_RALLY_FRAME,
    command: MAV_CMD_NAV_RALLY_POINT,
    current: 0,
    autocontinue: 1,
    params: [point.breakAlt ?? 0, point.landDir ?? 0, point.flags ?? 0, 0],
    x: degToScaled(point.lat),
    y: degToScaled(point.lon),
    z: point.alt,
  };
}

/**
 * Convert one wire {@link MissionItem} to a {@link RallyPoint}. The optional
 * extras (break altitude / landing direction / flags) are only set when their
 * param is non-zero, so a point with no extras round-trips back to no extras.
 */
export function rallyPointFromItem(item: MissionItem): RallyPoint {
  const point: RallyPoint = {
    lat: scaledToDeg(item.x),
    lon: scaledToDeg(item.y),
    alt: item.z,
  };
  const breakAlt = item.params[PARAM_INDEX_BREAK_ALT];
  const landDir = item.params[PARAM_INDEX_LAND_DIR];
  const flags = item.params[PARAM_INDEX_FLAGS];
  if (breakAlt !== 0) point.breakAlt = breakAlt;
  if (landDir !== 0) point.landDir = landDir;
  if (flags !== 0) point.flags = flags;
  return point;
}

/** Serialise a {@link Rally} to a wire `MISSION_TYPE_RALLY` {@link Mission}. */
export function rallyToMission(rally: Rally): Mission {
  return {
    type: 'rally',
    items: rally.points.map((point, seq) => rallyPointToItem(point, seq)),
  };
}

/**
 * Build a {@link Rally} from a wire {@link Mission}. Items that are not
 * `MAV_CMD_NAV_RALLY_POINT` are ignored, so a stray command can never be
 * misread as a rally point. `defaultAlt` is seeded from the first point.
 */
export function rallyFromMission(mission: Mission): Rally {
  const points = mission.items
    .filter((item) => item.command === MAV_CMD_NAV_RALLY_POINT)
    .map(rallyPointFromItem);
  const first = points[0];
  return { points, defaultAlt: first ? first.alt : DEFAULT_RALLY_ALT_M };
}

/** Default altitude (metres) for a rally point when none is supplied. */
export const DEFAULT_RALLY_ALT_M = 50;

/** A bare, valid empty `MISSION_TYPE_RALLY` mission for round-trip / reset paths. */
export function emptyRallyMission(): Mission {
  return { type: 'rally', items: [] };
}
