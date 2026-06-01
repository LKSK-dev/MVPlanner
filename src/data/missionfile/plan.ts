/**
 * QGroundControl `.plan` JSON parse + serialize (task T4.9; spec plan/04 §4.3,
 * plan/07 §7.6).
 *
 * A `.plan` is a JSON document of the shape:
 *
 * ```jsonc
 * {
 *   "fileType": "Plan", "version": 1, "groundStation": "MVPlanner",
 *   "mission": {
 *     "version": 2, "firmwareType": 0, "vehicleType": 0,
 *     "cruiseSpeed": 15, "hoverSpeed": 5,
 *     "plannedHomePosition": [lat, lon, alt],
 *     "items": [ { "type": "SimpleItem", "command": 16, "frame": 3,
 *                  "params": [p1, p2, p3, p4, lat, lon, alt],
 *                  "autoContinue": true, "doJumpId": 1 } ]
 *   },
 *   "geoFence": { "version": 2, "circles": [...], "polygons": [...] },
 *   "rallyPoints": { "version": 2, "points": [[lat, lon, alt], ...] }
 * }
 * ```
 *
 * Latitude/longitude are decimal degrees in the file. A `SimpleItem` carries the
 * 7 MAVLink params (`param1..4`, then `lat`, `lon`, `alt`); these map to a
 * {@link import('../../contracts').MissionItem} whose `x`/`y` are the integer
 * `×1e7` form of `lat`/`lon` and whose `z` is `alt`.
 */
import type { Mission, MissionItem } from '../../contracts';
import { degToE7, e7ToDeg } from './coords';
import type {
  LatLon,
  LatLonAlt,
  PlanFence,
  PlanFenceCircle,
  PlanFencePolygon,
  PlanFile,
  PlanRally,
} from './types';

/** `fileType` value of a plan document. */
const PLAN_FILE_TYPE = 'Plan';
/** Top-level `version` of a plan document. */
const PLAN_VERSION = 1;
/** Section `version` used by mission/geoFence/rallyPoints. */
const SECTION_VERSION = 2;
/** Default `groundStation` when none is present. */
const DEFAULT_GROUND_STATION = 'MVPlanner';
/** Default cruise speed (m/s) for a built plan. */
const DEFAULT_CRUISE_SPEED = 15;
/** Default hover speed (m/s) for a built plan. */
const DEFAULT_HOVER_SPEED = 5;

// ---------------------------------------------------------------------------
// Unknown-JSON readers (no `any`)
// ---------------------------------------------------------------------------

/** A non-null, non-array JSON object. */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Require `v` to be a finite number. */
function reqNum(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new Error(`.plan: ${label} must be a finite number`);
  }
  return v;
}

/** Read an optional finite number, falling back to `def`. */
function optNum(v: unknown, def: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : def;
}

/** Read an optional string, falling back to `def`. */
function optStr(v: unknown, def: string): string {
  return typeof v === 'string' ? v : def;
}

/** Require `v` to be an array. */
function reqArr(v: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(v)) {
    throw new Error(`.plan: ${label} must be an array`);
  }
  return v;
}

/** Read an optional array, defaulting to empty. */
function optArr(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : [];
}

/** Require `arr[i]` to be a finite number. */
function numIndex(arr: readonly unknown[], i: number, label: string): number {
  return reqNum(arr[i], `${label}[${i}]`);
}

/** Read a `[lat, lon]` pair. */
function readLatLon(v: unknown, label: string): LatLon {
  const a = reqArr(v, label);
  return [numIndex(a, 0, label), numIndex(a, 1, label)];
}

/** Read a `[lat, lon, alt]` triple. */
function readLatLonAlt(v: unknown, label: string): LatLonAlt {
  const a = reqArr(v, label);
  return [numIndex(a, 0, label), numIndex(a, 1, label), numIndex(a, 2, label)];
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/** Convert a parsed `SimpleItem` object into a {@link MissionItem}. */
function simpleToItem(v: unknown, index: number): MissionItem {
  if (!isRecord(v)) {
    throw new Error(`.plan: mission.items[${index}] must be an object`);
  }
  const type = v.type;
  if (type !== undefined && type !== 'SimpleItem') {
    throw new Error(
      `.plan: mission.items[${index}] has unsupported type "${String(type)}" ` +
        '(only SimpleItem is supported)',
    );
  }
  const params = reqArr(v.params, `mission.items[${index}].params`);
  if (params.length < 7) {
    throw new Error(`.plan: mission.items[${index}].params must have 7 entries`);
  }
  const label = `mission.items[${index}].params`;
  return {
    seq: index,
    current: 0,
    frame: reqNum(v.frame, `mission.items[${index}].frame`),
    command: reqNum(v.command, `mission.items[${index}].command`),
    params: [
      numIndex(params, 0, label),
      numIndex(params, 1, label),
      numIndex(params, 2, label),
      numIndex(params, 3, label),
    ],
    x: degToE7(numIndex(params, 4, label)),
    y: degToE7(numIndex(params, 5, label)),
    z: numIndex(params, 6, label),
    autocontinue: v.autoContinue === true ? 1 : 0,
  };
}

/** Read the `geoFence` section. */
function readFence(v: unknown): PlanFence {
  if (!isRecord(v)) {
    return { circles: [], polygons: [] };
  }
  const circles: PlanFenceCircle[] = optArr(v.circles).map((c, i) => {
    if (!isRecord(c)) {
      throw new Error(`.plan: geoFence.circles[${i}] must be an object`);
    }
    const circle = c.circle;
    if (!isRecord(circle)) {
      throw new Error(`.plan: geoFence.circles[${i}].circle must be an object`);
    }
    return {
      inclusion: c.inclusion === true,
      center: readLatLon(circle.center, `geoFence.circles[${i}].circle.center`),
      radius: reqNum(circle.radius, `geoFence.circles[${i}].circle.radius`),
    };
  });
  const polygons: PlanFencePolygon[] = optArr(v.polygons).map((p, i) => {
    if (!isRecord(p)) {
      throw new Error(`.plan: geoFence.polygons[${i}] must be an object`);
    }
    const verts = reqArr(p.polygon, `geoFence.polygons[${i}].polygon`);
    return {
      inclusion: p.inclusion === true,
      polygon: verts.map((vtx, j) => readLatLon(vtx, `geoFence.polygons[${i}].polygon[${j}]`)),
    };
  });
  return { circles, polygons };
}

/** Read the `rallyPoints` section. */
function readRally(v: unknown): PlanRally {
  if (!isRecord(v)) {
    return { points: [] };
  }
  const points = optArr(v.points).map((p, i) => readLatLonAlt(p, `rallyPoints.points[${i}]`));
  return { points };
}

/**
 * Parse a QGroundControl `.plan` document.
 *
 * @param text - The `.plan` JSON text (or an already-parsed object).
 * @returns The full {@link PlanFile} structure.
 * @throws If the JSON is invalid or required fields are missing/malformed.
 */
export function parsePlan(text: string | unknown): PlanFile {
  let root: unknown;
  if (typeof text === 'string') {
    try {
      root = JSON.parse(text);
    } catch (err) {
      throw new Error(`.plan: invalid JSON (${err instanceof Error ? err.message : String(err)})`);
    }
  } else {
    root = text;
  }
  if (!isRecord(root)) {
    throw new Error('.plan: document must be a JSON object');
  }
  if (root.fileType !== undefined && root.fileType !== PLAN_FILE_TYPE) {
    throw new Error(`.plan: fileType must be "${PLAN_FILE_TYPE}"`);
  }
  const mission = root.mission;
  if (!isRecord(mission)) {
    throw new Error('.plan: missing "mission" object');
  }
  const items = reqArr(mission.items, 'mission.items').map((it, i) => simpleToItem(it, i));
  return {
    groundStation: optStr(root.groundStation, DEFAULT_GROUND_STATION),
    firmwareType: optNum(mission.firmwareType, 0),
    vehicleType: optNum(mission.vehicleType, 0),
    cruiseSpeed: optNum(mission.cruiseSpeed, DEFAULT_CRUISE_SPEED),
    hoverSpeed: optNum(mission.hoverSpeed, DEFAULT_HOVER_SPEED),
    plannedHomePosition: readLatLonAlt(mission.plannedHomePosition, 'mission.plannedHomePosition'),
    mission: { type: 'mission', items },
    fence: readFence(root.geoFence),
    rally: readRally(root.rallyPoints),
  };
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/** Convert a {@link MissionItem} into a QGC `SimpleItem` object. */
function itemToSimple(item: MissionItem): Record<string, unknown> {
  return {
    AMSLAltAboveTerrain: null,
    Altitude: item.z,
    AltitudeMode: 1,
    autoContinue: item.autocontinue !== 0,
    command: item.command,
    doJumpId: item.seq + 1,
    frame: item.frame,
    params: [
      item.params[0],
      item.params[1],
      item.params[2],
      item.params[3],
      e7ToDeg(item.x),
      e7ToDeg(item.y),
      item.z,
    ],
    type: 'SimpleItem',
  };
}

/** Build the plain JSON object for a {@link PlanFile} (before stringify). */
function planToObject(plan: PlanFile): Record<string, unknown> {
  return {
    fileType: PLAN_FILE_TYPE,
    geoFence: {
      circles: plan.fence.circles.map((c) => ({
        inclusion: c.inclusion,
        circle: { center: [c.center[0], c.center[1]], radius: c.radius },
      })),
      polygons: plan.fence.polygons.map((p) => ({
        inclusion: p.inclusion,
        polygon: p.polygon.map((v) => [v[0], v[1]]),
      })),
      version: SECTION_VERSION,
    },
    groundStation: plan.groundStation,
    mission: {
      cruiseSpeed: plan.cruiseSpeed,
      firmwareType: plan.firmwareType,
      hoverSpeed: plan.hoverSpeed,
      items: plan.mission.items.map(itemToSimple),
      plannedHomePosition: [
        plan.plannedHomePosition[0],
        plan.plannedHomePosition[1],
        plan.plannedHomePosition[2],
      ],
      vehicleType: plan.vehicleType,
      version: SECTION_VERSION,
    },
    rallyPoints: {
      points: plan.rally.points.map((p) => [p[0], p[1], p[2]]),
      version: SECTION_VERSION,
    },
    version: PLAN_VERSION,
  };
}

/**
 * Serialize a {@link PlanFile} to QGroundControl `.plan` JSON text (4-space
 * indented, matching QGC's output style).
 *
 * @param plan - The plan to serialize.
 * @returns The `.plan` JSON string.
 */
export function serializePlan(plan: PlanFile): string {
  return `${JSON.stringify(planToObject(plan), null, 4)}\n`;
}

/**
 * Build a {@link PlanFile} from a bare mission, supplying QGC-required defaults.
 * The planned home position is taken from the first item's coordinate (or the
 * origin when the mission is empty); fence and rally start empty.
 *
 * @param mission - The mission items to wrap.
 * @param overrides - Optional metadata overrides (firmware/vehicle/speeds/home).
 * @returns A complete {@link PlanFile} ready for {@link serializePlan}.
 */
export function buildPlan(
  mission: Mission,
  overrides?: {
    readonly groundStation?: string;
    readonly firmwareType?: number;
    readonly vehicleType?: number;
    readonly cruiseSpeed?: number;
    readonly hoverSpeed?: number;
    readonly plannedHomePosition?: LatLonAlt;
    readonly fence?: PlanFence;
    readonly rally?: PlanRally;
  },
): PlanFile {
  const first = mission.items[0];
  const home: LatLonAlt =
    overrides?.plannedHomePosition ??
    (first ? [e7ToDeg(first.x), e7ToDeg(first.y), first.z] : [0, 0, 0]);
  return {
    groundStation: overrides?.groundStation ?? DEFAULT_GROUND_STATION,
    firmwareType: overrides?.firmwareType ?? 0,
    vehicleType: overrides?.vehicleType ?? 0,
    cruiseSpeed: overrides?.cruiseSpeed ?? DEFAULT_CRUISE_SPEED,
    hoverSpeed: overrides?.hoverSpeed ?? DEFAULT_HOVER_SPEED,
    plannedHomePosition: home,
    mission: { type: 'mission', items: mission.items },
    fence: overrides?.fence ?? { circles: [], polygons: [] },
    rally: overrides?.rally ?? { points: [] },
  };
}
