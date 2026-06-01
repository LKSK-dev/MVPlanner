/**
 * Mapping between the editing {@link Fence} model and the FROZEN
 * `MISSION_TYPE_FENCE` wire {@link Mission} / {@link MissionItem} contracts
 * (task T4.6; spec plan/04 §4.3). Pure, dependency-free.
 *
 * ArduPilot encodes a geofence as a flat `MISSION_TYPE_FENCE` item stream:
 *
 * - **Return point** → one {@link NAV_FENCE_RETURN_POINT} item.
 * - **Polygon** → *N* consecutive {@link NAV_FENCE_POLYGON_VERTEX_INCLUSION} /
 *   {@link NAV_FENCE_POLYGON_VERTEX_EXCLUSION} items, each carrying the polygon's
 *   total vertex count in `param1`; vertices are read back by consuming `param1`
 *   consecutive same-command items.
 * - **Circle** → one {@link NAV_FENCE_CIRCLE_INCLUSION} /
 *   {@link NAV_FENCE_CIRCLE_EXCLUSION} item with the radius (metres) in `param1`.
 *
 * Positions live in the item's `x`/`y` as `degrees × 1e7` (the
 * `MISSION_ITEM_INT` scale), applied here via `geo/mission`'s
 * {@link degToScaled} / {@link scaledToDeg} so the editor never sees the factor.
 *
 * The altitude limits and breach action are *parameters*, not items, so they do
 * not round-trip through this conversion; `./model` maps them to `FENCE_*`
 * params. {@link fenceFromMission} therefore seeds those fields from defaults
 * (overridable via `opts`).
 */
import type { Mission, MissionItem } from '../../contracts';
import { degToScaled, scaledToDeg } from '../mission';
import {
  FENCE_FRAME_GLOBAL,
  NAV_FENCE_CIRCLE_EXCLUSION,
  NAV_FENCE_CIRCLE_INCLUSION,
  NAV_FENCE_POLYGON_VERTEX_EXCLUSION,
  NAV_FENCE_POLYGON_VERTEX_INCLUSION,
  NAV_FENCE_RETURN_POINT,
  isCircleCommand,
  isPolygonVertexCommand,
} from './commands';
import { DEFAULT_FENCE_ACTION, DEFAULT_MAX_ALT_M, DEFAULT_MIN_ALT_M } from './model';
import type { Fence, FenceCircle, FencePolygon, FenceShape } from './types';

/** Build a fence {@link MissionItem} with the fence frame and unused fields zeroed. */
function fenceItem(
  seq: number,
  command: number,
  param1: number,
  lat: number,
  lon: number,
): MissionItem {
  return {
    seq,
    frame: FENCE_FRAME_GLOBAL,
    command,
    current: 0,
    autocontinue: 1,
    params: [param1, 0, 0, 0],
    x: degToScaled(lat),
    y: degToScaled(lon),
    z: 0,
  };
}

/**
 * Serialise a {@link Fence} to a `MISSION_TYPE_FENCE` {@link Mission}.
 *
 * Item order: the return point (if any) first, then each shape in list order.
 * Polygons emit one item per vertex (each tagged with the polygon's vertex
 * count); empty polygons (`< 1` vertex) and non-positive-radius circles are
 * skipped, since neither has a valid wire encoding. `seq` is the item index.
 */
export function fenceToMission(fence: Fence): Mission {
  const items: MissionItem[] = [];
  const push = (command: number, param1: number, lat: number, lon: number): void => {
    items.push(fenceItem(items.length, command, param1, lat, lon));
  };

  if (fence.returnPoint) {
    push(NAV_FENCE_RETURN_POINT, 0, fence.returnPoint.lat, fence.returnPoint.lon);
  }

  for (const shape of fence.shapes) {
    if (shape.kind === 'polygon') {
      const count = shape.vertices.length;
      if (count < 1) continue;
      const command =
        shape.inclusion === 'inclusion'
          ? NAV_FENCE_POLYGON_VERTEX_INCLUSION
          : NAV_FENCE_POLYGON_VERTEX_EXCLUSION;
      for (const v of shape.vertices) push(command, count, v.lat, v.lon);
    } else {
      if (!(shape.radiusM > 0)) continue;
      const command =
        shape.inclusion === 'inclusion' ? NAV_FENCE_CIRCLE_INCLUSION : NAV_FENCE_CIRCLE_EXCLUSION;
      push(command, shape.radiusM, shape.center.lat, shape.center.lon);
    }
  }

  return { type: 'fence', items };
}

/** Overridable non-spatial fields seeded onto a decoded {@link Fence}. */
export interface FenceFromMissionOptions {
  /** Minimum altitude (metres); defaults to {@link DEFAULT_MIN_ALT_M}. */
  minAltM?: number;
  /** Maximum altitude (metres); defaults to {@link DEFAULT_MAX_ALT_M}. */
  maxAltM?: number;
  /** Breach action; defaults to {@link DEFAULT_FENCE_ACTION}. */
  breachAction?: number;
}

/**
 * Rebuild a {@link Fence} from a `MISSION_TYPE_FENCE` {@link Mission}.
 *
 * Polygon vertices are grouped by consuming `param1` consecutive same-command
 * items (ArduPilot's encoding); a return point becomes {@link Fence.returnPoint}.
 * Altitude limits and breach action are not present in the item stream, so they
 * are seeded from `opts` / module defaults.
 */
export function fenceFromMission(mission: Mission, opts: FenceFromMissionOptions = {}): Fence {
  const shapes: FenceShape[] = [];
  let returnPoint: Fence['returnPoint'];
  const items = mission.items;

  for (let i = 0; i < items.length; ) {
    const item = items[i];
    if (item === undefined) {
      i += 1;
      continue;
    }
    if (item.command === NAV_FENCE_RETURN_POINT) {
      returnPoint = { lat: scaledToDeg(item.x), lon: scaledToDeg(item.y) };
      i += 1;
    } else if (isPolygonVertexCommand(item.command)) {
      const inclusion =
        item.command === NAV_FENCE_POLYGON_VERTEX_INCLUSION ? 'inclusion' : 'exclusion';
      const declared = Math.max(1, Math.round(item.params[0]));
      const vertices: { lat: number; lon: number }[] = [];
      let j = i;
      while (j < items.length && vertices.length < declared) {
        const v = items[j];
        if (v === undefined || v.command !== item.command) break;
        vertices.push({ lat: scaledToDeg(v.x), lon: scaledToDeg(v.y) });
        j += 1;
      }
      const polygon: FencePolygon = { kind: 'polygon', inclusion, vertices };
      shapes.push(polygon);
      i = j;
    } else if (isCircleCommand(item.command)) {
      const inclusion = item.command === NAV_FENCE_CIRCLE_INCLUSION ? 'inclusion' : 'exclusion';
      const circle: FenceCircle = {
        kind: 'circle',
        inclusion,
        center: { lat: scaledToDeg(item.x), lon: scaledToDeg(item.y) },
        radiusM: item.params[0],
      };
      shapes.push(circle);
      i += 1;
    } else {
      i += 1;
    }
  }

  return {
    shapes,
    ...(returnPoint !== undefined ? { returnPoint } : {}),
    minAltM: opts.minAltM ?? DEFAULT_MIN_ALT_M,
    maxAltM: opts.maxAltM ?? DEFAULT_MAX_ALT_M,
    breachAction: opts.breachAction ?? DEFAULT_FENCE_ACTION,
  };
}
