/**
 * `data/missionfile` public surface (task T4.9; spec plan/04 §4.3, plan/07
 * §7.6).
 *
 * Mission file I/O for the Plan screen:
 *
 *  - **`QGC WPL 110`** `.waypoints`/`.txt` parse/serialize (`parseWpl` /
 *    `serializeWpl`) with exact `×1e7` latitude/longitude round-tripping.
 *  - **QGroundControl `.plan`** JSON parse/serialize (`parsePlan` /
 *    `serializePlan`, plus `buildPlan` to wrap a bare mission) covering mission,
 *    geofence and rally points.
 *  - **KML / GPX** import (`importKml` / `importGpx`) into a simple
 *    `NAV_WAYPOINT` mission.
 *  - {@link import('../../contracts').FileIo}-based `loadMissionFile` /
 *    `saveMission` / `savePlanFile` with extension+content format detection
 *    (`detectFormat`).
 *
 * Cross-module consumers import from here, never deep paths. See `./README.md`.
 */
export {
  MAV_CMD_NAV_WAYPOINT,
  MAV_FRAME_GLOBAL_RELATIVE_ALT,
  degToE7,
  e7ToDeg,
  e7ToDegString,
} from './coords';
export { parseWpl, serializeWpl, WPL_HEADER } from './wpl';
export { parsePlan, serializePlan, buildPlan } from './plan';
export { importKml, importGpx } from './importers';
export {
  detectFormat,
  loadMissionFile,
  parseMissionContent,
  saveMission,
  savePlanFile,
  MISSION_FILE_ACCEPT,
  WPL_MIME,
  PLAN_MIME,
  DEFAULT_WPL_NAME,
  DEFAULT_PLAN_NAME,
} from './fileio';
export type {
  ImportOptions,
  LatLon,
  LatLonAlt,
  LoadedMission,
  MissionFileFormat,
  MissionSaveFormat,
  PlanFence,
  PlanFenceCircle,
  PlanFencePolygon,
  PlanFile,
  PlanRally,
} from './types';
