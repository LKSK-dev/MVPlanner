/**
 * ArduPilot geofence `MAV_CMD` ids, frame, breach-action enum and the
 * `FENCE_*` parameter names used by the geofence model (task T4.6; spec
 * plan/04 §4.3). Pure, dependency-free constants shared by `./convert`,
 * `./model` and the editor UI.
 */

/** `MAV_CMD_NAV_FENCE_RETURN_POINT` (5000) — the fence return point. */
export const NAV_FENCE_RETURN_POINT = 5000;
/**
 * `MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION` (5001) — one vertex of an
 * inclusion polygon; `param1` is the polygon's *total* vertex count, shared by
 * all of its vertices.
 */
export const NAV_FENCE_POLYGON_VERTEX_INCLUSION = 5001;
/**
 * `MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION` (5002) — one vertex of an
 * exclusion polygon; `param1` is the polygon's total vertex count.
 */
export const NAV_FENCE_POLYGON_VERTEX_EXCLUSION = 5002;
/**
 * `MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION` (5003) — an inclusion circle; `param1`
 * is the radius in metres, `x`/`y` the centre.
 */
export const NAV_FENCE_CIRCLE_INCLUSION = 5003;
/**
 * `MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION` (5004) — an exclusion circle; `param1`
 * is the radius in metres, `x`/`y` the centre.
 */
export const NAV_FENCE_CIRCLE_EXCLUSION = 5004;

/**
 * `MAV_FRAME_GLOBAL` (0) — fence items carry absolute lat/lon with altitude
 * unused; ArduPilot uploads fence vertices in this frame.
 */
export const FENCE_FRAME_GLOBAL = 0;

/**
 * ArduPilot `FENCE_ACTION` values (the geofence breach response). Mirrors the
 * `FENCE_ACTION` parameter metadata; `Report` only logs, the rest recover.
 */
export const FenceBreachAction = {
  /** Report only (no autonomous action). */
  Report: 0,
  /** RTL or Land. */
  RtlOrLand: 1,
  /** Always Land. */
  AlwaysLand: 2,
  /** SmartRTL or RTL or Land. */
  SmartRtlOrRtlOrLand: 3,
  /** Brake or Land. */
  BrakeOrLand: 4,
  /** SmartRTL or Land. */
  SmartRtlOrLand: 5,
} as const;

/** Union of {@link FenceBreachAction} values. */
export type FenceBreachActionValue = (typeof FenceBreachAction)[keyof typeof FenceBreachAction];

/** Breach actions in display order, for the editor's selector. */
export const FENCE_BREACH_ACTIONS: readonly FenceBreachActionValue[] = [
  FenceBreachAction.Report,
  FenceBreachAction.RtlOrLand,
  FenceBreachAction.AlwaysLand,
  FenceBreachAction.SmartRtlOrRtlOrLand,
  FenceBreachAction.BrakeOrLand,
  FenceBreachAction.SmartRtlOrLand,
];

/** ArduPilot parameter name for the minimum fence altitude (metres). */
export const FENCE_ALT_MIN_PARAM = 'FENCE_ALT_MIN';
/** ArduPilot parameter name for the maximum fence altitude (metres). */
export const FENCE_ALT_MAX_PARAM = 'FENCE_ALT_MAX';
/** ArduPilot parameter name for the breach action (`FENCE_ACTION`). */
export const FENCE_ACTION_PARAM = 'FENCE_ACTION';

/** True for the two polygon-vertex `MAV_CMD` ids (inclusion or exclusion). */
export function isPolygonVertexCommand(command: number): boolean {
  return (
    command === NAV_FENCE_POLYGON_VERTEX_INCLUSION || command === NAV_FENCE_POLYGON_VERTEX_EXCLUSION
  );
}

/** True for the two circle `MAV_CMD` ids (inclusion or exclusion). */
export function isCircleCommand(command: number): boolean {
  return command === NAV_FENCE_CIRCLE_INCLUSION || command === NAV_FENCE_CIRCLE_EXCLUSION;
}
