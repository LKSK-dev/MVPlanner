/**
 * `geo/mission` public surface (task T4.2; spec plan/04 §4.3).
 *
 * A pure, testable **mission editing model** layered on the FROZEN wire
 * {@link import('../../contracts').Mission} / {@link import('../../contracts').MissionItem}
 * contracts: ordered command list with altitude-frame handling, default
 * altitude/frame for new waypoints, immutable edit ops (add/insert/delete/
 * reorder/setItem), great-circle distance + time estimates, and the
 * model↔contracts mapping (degrees ↔ 1e7-scaled `x`/`y`).
 *
 * Cross-module consumers (waypoint table T4.3, map editing T4.4, the command
 * editor) import from here, never deep paths (conventions
 * plan/implementation/00 §0.3).
 *
 * @see ./README.md for the model API and conventions.
 */
export type {
  AltFrame,
  MissionEstimate,
  MissionItemModel,
  MissionModel,
  MissionType,
} from './types';

export {
  ALT_FRAMES,
  DEFAULT_MISSION_FRAME,
  MAV_FRAME_GLOBAL_INT,
  MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
  MAV_FRAME_GLOBAL_TERRAIN_ALT,
  altFrameToMavFrame,
  mavFrameToAltFrame,
} from './frames';

export {
  MAV_CMD_PARAM_COUNT,
  PARAM_INDEX_X,
  PARAM_INDEX_Y,
  PARAM_INDEX_Z,
  buildCommandCatalog,
  commandHasPosition,
  commandMeta,
  defaultCommandCatalog,
  type MavCmdCategory,
  type MavCmdMeta,
} from './commands';

export {
  DEFAULT_ALT_M,
  LATLON_SCALE,
  degToScaled,
  emptyWireMission,
  itemFromWire,
  itemToWire,
  missionFromWire,
  missionToWire,
  scaledToDeg,
} from './convert';

export {
  DEFAULT_CRUISE_MPS,
  EARTH_RADIUS_M,
  NAV_WAYPOINT,
  addWaypoint,
  createMission,
  deleteItem,
  estimateMission,
  haversineMeters,
  insertItem,
  makeWaypoint,
  reorder,
  setCurrent,
  setDefaultAlt,
  setDefaultFrame,
  setItem,
  type CreateMissionOptions,
  type EstimateOptions,
  type WaypointOptions,
} from './model';
