/**
 * `geo/rally` public surface (task T4.7; spec plan/04 §4.3 rally).
 *
 * A pure, testable **rally-points model** layered on the FROZEN wire
 * {@link import('../../contracts').Mission} /
 * {@link import('../../contracts').MissionItem} contracts for
 * `MISSION_TYPE_RALLY`: an ordered list of rally points (lat/lon/alt plus the
 * optional break altitude / landing direction / flags), immutable edit ops
 * (add/insert/delete/set/reorder), and the model↔contracts mapping
 * (`MAV_CMD_NAV_RALLY_POINT`, degrees ↔ 1e7-scaled `x`/`y`).
 *
 * Cross-module consumers (the rally editor T4.7, map editing T4.4, the Plan
 * assembly's upload via `MissionClient`) import from here, never deep paths
 * (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the model API and the wire mapping.
 */
export type { Rally, RallyPoint, RallyLatLon, LatLon } from './types';

export {
  DEFAULT_RALLY_ALT_M,
  DEFAULT_RALLY_FRAME,
  MAV_CMD_NAV_RALLY_POINT,
  PARAM_INDEX_BREAK_ALT,
  PARAM_INDEX_FLAGS,
  PARAM_INDEX_LAND_DIR,
  RALLY_FLAG_FAVORABLE_WIND,
  RALLY_FLAG_LAND_IMMEDIATELY,
  RALLY_LATLON_SCALE,
  degToScaled,
  emptyRallyMission,
  rallyFromMission,
  rallyPointFromItem,
  rallyPointToItem,
  rallyToMission,
  scaledToDeg,
} from './convert';

export {
  addRallyPoint,
  createRally,
  deleteRallyPoint,
  insertRallyPoint,
  makeRallyPoint,
  reorderRally,
  setDefaultAlt,
  setRallyPoint,
  type CreateRallyOptions,
  type RallyPointOptions,
  type RallyPatch,
} from './model';
