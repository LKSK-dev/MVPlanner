/**
 * Survey-grid → mission conversion for `geo/survey` (task T4.5; spec plan/04
 * §4.3). Pure: builds a {@link Mission} of `NAV_WAYPOINT` items at the survey
 * altitude from a {@link SurveyGrid}, optionally bracketed by camera-trigger
 * (`DO_SET_CAM_TRIGG_DIST`) items so photos fire by distance along the lines.
 *
 * The mission `model`/`service` (sibling tasks T4.1/T4.2) own upload + editing;
 * this helper only assembles standard {@link MissionItem}s from the grid, so it
 * stays decoupled and unit-testable.
 */
import type { Mission, MissionItem } from '../../contracts';
import { degToScaled } from '../mission';
import type { SurveyGrid } from './types';

/** `MAV_CMD_NAV_WAYPOINT` (16) — fly to a waypoint. */
export const CMD_NAV_WAYPOINT = 16;
/** `MAV_CMD_DO_SET_CAM_TRIGG_DIST` (206) — trigger the camera by distance. */
export const CMD_DO_SET_CAM_TRIGG_DIST = 206;
/** `MAV_FRAME_GLOBAL_RELATIVE_ALT` (3) — altitude relative to home. */
export const FRAME_GLOBAL_RELATIVE_ALT = 3;

/** Options for {@link surveyToMission}. */
export interface SurveyMissionOptions {
  /** Override the survey altitude (metres); defaults to `grid.altitudeM`. */
  altitudeM?: number;
  /** Altitude frame for the waypoints; defaults to relative-alt (`3`). */
  frame?: number;
  /** First item `seq` number; defaults to `0`. */
  startSeq?: number;
  /**
   * Emit `DO_SET_CAM_TRIGG_DIST` items bracketing the lines. Defaults to `true`
   * when the grid has a positive trigger distance.
   */
  cameraTrigger?: boolean;
}

/** Build a single {@link MissionItem} with sane defaults. */
function item(
  seq: number,
  command: number,
  frame: number,
  params: [number, number, number, number],
  x: number,
  y: number,
  z: number,
): MissionItem {
  return { seq, frame, command, current: 0, autocontinue: 1, params, x, y, z };
}

/**
 * Convert a {@link SurveyGrid} into a `MISSION_TYPE` mission of `NAV_WAYPOINT`
 * items at the survey altitude. When camera triggering is enabled (and the
 * grid's trigger distance is positive) a `DO_SET_CAM_TRIGG_DIST` item is
 * prepended (distance = trigger distance) and a matching disable item (distance
 * `0`) is appended.
 */
export function surveyToMission(grid: SurveyGrid, opts: SurveyMissionOptions = {}): Mission {
  const altitudeM = opts.altitudeM ?? grid.altitudeM;
  const frame = opts.frame ?? FRAME_GLOBAL_RELATIVE_ALT;
  const startSeq = opts.startSeq ?? 0;
  const triggerDistanceM = grid.estimates.triggerDistanceM;
  const useTrigger = (opts.cameraTrigger ?? true) && triggerDistanceM > 0;

  const items: MissionItem[] = [];
  let seq = startSeq;

  if (useTrigger) {
    // param1 = distance (m); param3 = 1 → also trigger one frame immediately.
    items.push(item(seq, CMD_DO_SET_CAM_TRIGG_DIST, 0, [triggerDistanceM, 0, 1, 0], 0, 0, 0));
    seq += 1;
  }

  for (const wp of grid.waypoints) {
    items.push(
      item(
        seq,
        CMD_NAV_WAYPOINT,
        frame,
        [0, 0, 0, 0],
        degToScaled(wp.lat),
        degToScaled(wp.lon),
        altitudeM,
      ),
    );
    seq += 1;
  }

  if (useTrigger) {
    // Disable distance triggering at the end of the survey.
    items.push(item(seq, CMD_DO_SET_CAM_TRIGG_DIST, 0, [0, 0, 0, 0], 0, 0, 0));
  }

  return { type: 'mission', items };
}
