/**
 * `geo/fence` public surface (task T4.6; spec plan/04 §4.3 Geofence).
 *
 * A pure, testable **geofence editing model** layered on the FROZEN
 * `MISSION_TYPE_FENCE` wire {@link import('../../contracts').Mission} /
 * {@link import('../../contracts').MissionItem} contracts: inclusion/exclusion
 * polygons + circles, an optional return point, and the non-spatial altitude
 * limits + breach action (exposed both on the model and as `FENCE_*` params).
 * Includes the model ↔ items conversion using ArduPilot fence `MAV_CMD`s
 * (degrees ↔ `1e7`-scaled `x`/`y`).
 *
 * Cross-module consumers (the fence editor T4.6 UI, map editing T4.4, the Plan
 * assembly T4.10) import from here, never deep paths (conventions
 * plan/implementation/00 §0.3).
 *
 * @see ./README.md for the model API, the `MAV_CMD` mapping and how to test.
 */
export type {
  Fence,
  FenceCircle,
  FenceInclusion,
  FencePolygon,
  FenceShape,
  FenceShapeKind,
} from './types';

export {
  FENCE_ACTION_PARAM,
  FENCE_ALT_MAX_PARAM,
  FENCE_ALT_MIN_PARAM,
  FENCE_BREACH_ACTIONS,
  FENCE_FRAME_GLOBAL,
  FenceBreachAction,
  NAV_FENCE_CIRCLE_EXCLUSION,
  NAV_FENCE_CIRCLE_INCLUSION,
  NAV_FENCE_POLYGON_VERTEX_EXCLUSION,
  NAV_FENCE_POLYGON_VERTEX_INCLUSION,
  NAV_FENCE_RETURN_POINT,
  isCircleCommand,
  isPolygonVertexCommand,
  type FenceBreachActionValue,
} from './commands';

export { fenceFromMission, fenceToMission, type FenceFromMissionOptions } from './convert';

export {
  DEFAULT_CIRCLE_RADIUS_M,
  DEFAULT_FENCE_ACTION,
  DEFAULT_MAX_ALT_M,
  DEFAULT_MIN_ALT_M,
  addCircle,
  addPolygon,
  addShape,
  createFence,
  fenceParams,
  removeShape,
  setBreachAction,
  setCircleRadius,
  setInclusion,
  setMaxAlt,
  setMinAlt,
  setReturnPoint,
  setShape,
  type CreateFenceOptions,
  type FenceParam,
} from './model';
