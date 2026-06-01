/**
 * Pure map-editing reducer + overlay derivations (task T4.4; spec plan/04 §4.3
 * map editing). No DOM, no map engine — given an {@link EditState}, the active
 * {@link PlanToolMode} and a {@link MapEditEvent}, {@link dispatchMapEdit}
 * returns a NEW {@link EditState}, never mutating its input. The controller
 * (`./controller`) maps engine clicks / drags into these events and writes the
 * result back to the shared signals; this module owns all the editing logic so
 * it is trivially unit-testable with plain values.
 *
 * Geometry edits compose the FROZEN `geo/*` model ops (`addWaypoint`,
 * `setItem`, `deleteItem`, `addRallyPoint`, `setRallyPoint`, `deleteRallyPoint`,
 * `addPolygon`, `addCircle`, `setShape`, `removeShape`, `setCircleRadius`) — the
 * map editor never reaches into the wire scale factor or invents new model
 * shapes.
 */
import type { LatLon } from '../../../../geo/format';
import {
  addCircle,
  addPolygon,
  removeShape,
  setCircleRadius,
  setShape,
  type Fence,
  type FencePolygon,
} from '../../../../geo/fence';
import {
  addWaypoint,
  commandHasPosition,
  deleteItem,
  haversineMeters,
  setItem,
  type MissionModel,
} from '../../../../geo/mission';
import {
  addRallyPoint,
  deleteRallyPoint,
  setRallyPoint,
  type Rally,
} from '../../../../geo/rally';
import type { MissionOverlay, GeofenceOverlay, RallyOverlay } from '../../../widgets/map/layers';
import type { EditState, FeatureRef, MapEditEvent, PlanToolMode } from './types';

/** Default radius (metres) for a circle first dropped on the map by click. */
export const DEFAULT_MAP_CIRCLE_RADIUS_M = 100;

/** Index of the last polygon shape in a fence, or `-1` when there is none. */
function lastPolygonIndex(fence: Fence): number {
  for (let i = fence.shapes.length - 1; i >= 0; i--) {
    if (fence.shapes[i]?.kind === 'polygon') return i;
  }
  return -1;
}

/** Index of the last circle shape in a fence, or `-1` when there is none. */
function lastCircleIndex(fence: Fence): number {
  for (let i = fence.shapes.length - 1; i >= 0; i--) {
    if (fence.shapes[i]?.kind === 'circle') return i;
  }
  return -1;
}

/** Append `at` as a vertex of the active (last) fence polygon, creating one if none. */
function appendFenceVertex(fence: Fence, at: LatLon): Fence {
  let working = fence;
  let index = lastPolygonIndex(working);
  if (index < 0) {
    working = addPolygon(working, 'inclusion');
    index = working.shapes.length - 1;
  }
  const shape = working.shapes[index];
  if (shape === undefined || shape.kind !== 'polygon') return working;
  const next: FencePolygon = {
    kind: 'polygon',
    inclusion: shape.inclusion,
    vertices: [...shape.vertices, at],
  };
  return setShape(working, index, next);
}

/** Set the centre of the active (last) fence circle at `at`, creating one if none. */
function placeFenceCircle(fence: Fence, at: LatLon): Fence {
  const index = lastCircleIndex(fence);
  if (index < 0) {
    return addCircle(fence, 'exclusion', at, DEFAULT_MAP_CIRCLE_RADIUS_M);
  }
  const shape = fence.shapes[index];
  if (shape === undefined || shape.kind !== 'circle') return fence;
  return setShape(fence, index, { ...shape, center: at });
}

/** Apply a click to the model bundle, dispatching on the active tool mode. */
function applyClick(state: EditState, mode: PlanToolMode, at: LatLon): EditState {
  switch (mode) {
    case 'add-waypoint':
      return { ...state, mission: addWaypoint(state.mission, at) };
    case 'draw-fence-polygon':
      return { ...state, fence: appendFenceVertex(state.fence, at) };
    case 'draw-fence-circle':
      return { ...state, fence: placeFenceCircle(state.fence, at) };
    case 'place-rally':
      return { ...state, rally: addRallyPoint(state.rally, at) };
    case 'draw-survey-polygon':
      return { ...state, surveyPolygon: [...state.surveyPolygon, at] };
    case 'select':
    case 'measure':
      return state;
  }
}

/** Move the referenced feature to `at`, returning a new {@link EditState}. */
function applyDrag(state: EditState, ref: FeatureRef, at: LatLon): EditState {
  switch (ref.kind) {
    case 'waypoint':
      return { ...state, mission: setItem(state.mission, ref.index, { lat: at.lat, lon: at.lon }) };
    case 'rally':
      return { ...state, rally: setRallyPoint(state.rally, ref.index, { lat: at.lat, lon: at.lon }) };
    case 'survey-vertex': {
      if (ref.index < 0 || ref.index >= state.surveyPolygon.length) return state;
      const surveyPolygon = state.surveyPolygon.map((v, i) => (i === ref.index ? at : v));
      return { ...state, surveyPolygon };
    }
    case 'fence-vertex': {
      const shape = state.fence.shapes[ref.shapeIndex];
      if (shape === undefined || shape.kind !== 'polygon') return state;
      if (ref.vertexIndex < 0 || ref.vertexIndex >= shape.vertices.length) return state;
      const vertices = shape.vertices.map((v, i) => (i === ref.vertexIndex ? at : v));
      const next: FencePolygon = { kind: 'polygon', inclusion: shape.inclusion, vertices };
      return { ...state, fence: setShape(state.fence, ref.shapeIndex, next) };
    }
    case 'fence-center': {
      const shape = state.fence.shapes[ref.shapeIndex];
      if (shape === undefined || shape.kind !== 'circle') return state;
      return { ...state, fence: setShape(state.fence, ref.shapeIndex, { ...shape, center: at }) };
    }
  }
}

/** Delete the referenced feature, returning a new {@link EditState}. */
function applyDelete(state: EditState, ref: FeatureRef): EditState {
  switch (ref.kind) {
    case 'waypoint':
      return { ...state, mission: deleteItem(state.mission, ref.index) };
    case 'rally':
      return { ...state, rally: deleteRallyPoint(state.rally, ref.index) };
    case 'survey-vertex': {
      if (ref.index < 0 || ref.index >= state.surveyPolygon.length) return state;
      return { ...state, surveyPolygon: state.surveyPolygon.filter((_, i) => i !== ref.index) };
    }
    case 'fence-vertex': {
      const shape = state.fence.shapes[ref.shapeIndex];
      if (shape === undefined || shape.kind !== 'polygon') return state;
      const vertices = shape.vertices.filter((_, i) => i !== ref.vertexIndex);
      const next: FencePolygon = { kind: 'polygon', inclusion: shape.inclusion, vertices };
      return { ...state, fence: setShape(state.fence, ref.shapeIndex, next) };
    }
    case 'fence-center':
      return { ...state, fence: removeShape(state.fence, ref.shapeIndex) };
  }
}

/**
 * The pure map-editing reducer: apply one {@link MapEditEvent} to `state` under
 * the active `mode`, returning a NEW {@link EditState}. Clicks are interpreted
 * per `mode`; drags / deletes / radius-sets act on the referenced feature
 * regardless of mode.
 */
export function dispatchMapEdit(
  state: EditState,
  mode: PlanToolMode,
  event: MapEditEvent,
): EditState {
  switch (event.kind) {
    case 'click':
      return applyClick(state, mode, event.at);
    case 'drag':
      return applyDrag(state, event.ref, event.at);
    case 'delete':
      return applyDelete(state, event.ref);
    case 'set-fence-radius':
      return { ...state, fence: setCircleRadius(state.fence, event.shapeIndex, event.radiusM) };
  }
}

// --- overlay derivations (shared models → existing map layer shapes) --------

/** A projection from a coordinate to a screen point (the engine's `project`). */
export type Project = (lat: number, lon: number) => [number, number];

/** Derive the {@link MissionOverlay} the mission layer renders from the model. */
export function toMissionOverlay(mission: MissionModel): MissionOverlay {
  return {
    waypoints: mission.items.map((item, seq) => ({
      seq,
      lat: item.lat,
      lon: item.lon,
      nav: commandHasPosition(item.command),
      label: String(seq + 1),
    })),
  };
}

/** Derive the {@link GeofenceOverlay} the fence layer renders from the model. */
export function toFenceOverlay(fence: Fence): GeofenceOverlay {
  const polygons: LatLon[][] = [];
  const circles: GeofenceOverlay['circles'] = [];
  for (const shape of fence.shapes) {
    if (shape.kind === 'polygon') {
      polygons.push(shape.vertices.map((v) => ({ lat: v.lat, lon: v.lon })));
    } else {
      circles.push({
        lat: shape.center.lat,
        lon: shape.center.lon,
        radiusM: shape.radiusM,
        inclusion: shape.inclusion === 'inclusion',
      });
    }
  }
  return { polygons, circles };
}

/** Derive the {@link RallyOverlay} the rally layer renders from the model. */
export function toRallyOverlay(rally: Rally): RallyOverlay {
  return {
    points: rally.points.map((p, i) => ({ lat: p.lat, lon: p.lon, label: String(i + 1) })),
  };
}

/** A screen-space squared distance between two points. */
function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}

/**
 * Hit-test the plan geometry at screen point `(px, py)`, returning the nearest
 * draggable {@link FeatureRef} within `radiusPx` (device pixels), or `undefined`.
 * Pure given a `project`; the controller supplies the engine projection. The
 * search covers mission waypoints, rally points, fence centres + vertices, and
 * survey vertices, picking the closest.
 */
export function hitTest(
  state: EditState,
  project: Project,
  px: number,
  py: number,
  radiusPx: number,
): FeatureRef | undefined {
  const r2 = radiusPx * radiusPx;
  let best: FeatureRef | undefined;
  let bestD = r2;
  const consider = (lat: number, lon: number, ref: FeatureRef): void => {
    const [sx, sy] = project(lat, lon);
    const d = dist2(px, py, sx, sy);
    if (d <= bestD) {
      bestD = d;
      best = ref;
    }
  };

  state.mission.items.forEach((item, index) => {
    if (commandHasPosition(item.command)) consider(item.lat, item.lon, { kind: 'waypoint', index });
  });
  state.rally.points.forEach((p, index) => consider(p.lat, p.lon, { kind: 'rally', index }));
  state.fence.shapes.forEach((shape, shapeIndex) => {
    if (shape.kind === 'circle') {
      consider(shape.center.lat, shape.center.lon, { kind: 'fence-center', shapeIndex });
    } else {
      shape.vertices.forEach((v, vertexIndex) =>
        consider(v.lat, v.lon, { kind: 'fence-vertex', shapeIndex, vertexIndex }),
      );
    }
  });
  state.surveyPolygon.forEach((v, index) =>
    consider(v.lat, v.lon, { kind: 'survey-vertex', index }),
  );

  return best;
}

/** Re-export for callers measuring a circle radius from a centre/edge drag. */
export { haversineMeters };
