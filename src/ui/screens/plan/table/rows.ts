/**
 * Pure table-row derivation + totals formatting for the waypoint table (task
 * T4.3; spec plan/04 §4.3). DOM-free and side-effect-free so it unit-tests in
 * isolation. The component renders straight from {@link toRows} /
 * {@link missionTotals}.
 */
import type { UnitSystem } from '../../../../contracts';
import {
  commandHasPosition,
  commandMeta,
  estimateMission,
  mavFrameToAltFrame,
  type MissionModel,
} from '../../../../geo/mission';
import { formatDistance } from '../../../../core/units';
import type { WaypointRow, WaypointTotals } from './types';

/**
 * Project `model` into ordered, display-ready {@link WaypointRow}s. Pure: the
 * returned rows mirror `model.items` (index → `seq`) with the active flag,
 * semantic altitude frame and command name resolved.
 */
export function toRows(model: MissionModel): readonly WaypointRow[] {
  return model.items.map((item, seq) => {
    const meta = commandMeta(item.command);
    return {
      seq,
      command: item.command,
      commandName: meta?.shortName ?? String(item.command),
      frame: item.frame,
      altFrame: mavFrameToAltFrame(item.frame),
      lat: item.lat,
      lon: item.lon,
      alt: item.alt,
      params: item.params,
      autocontinue: item.autocontinue,
      isCurrent: seq === model.currentSeq,
      hasPosition: commandHasPosition(item.command),
    };
  });
}

/**
 * Format a duration (seconds) as `m:ss`, or `h:mm:ss` past an hour.
 * Locale-independent (clock-style), matching common GCS time readouts.
 */
export function formatDurationS(totalSeconds: number): string {
  const s = Number.isFinite(totalSeconds) ? Math.max(0, Math.round(totalSeconds)) : 0;
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Options for {@link missionTotals}. */
export interface TotalsOptions {
  /** Unit system used to format the distance (default `'metric'`). */
  units?: UnitSystem;
  /** Cruise speed (m/s) for the time estimate. */
  cruiseSpeedMps?: number;
}

/**
 * Compute the formatted mission totals (distance, time, waypoint count) shown in
 * the table header. Distance is unit-formatted via `core/units`; time is a
 * clock-style string.
 */
export function missionTotals(model: MissionModel, opts: TotalsOptions = {}): WaypointTotals {
  const units: UnitSystem = opts.units ?? 'metric';
  const estimate = estimateMission(
    model,
    opts.cruiseSpeedMps !== undefined ? { cruiseSpeedMps: opts.cruiseSpeedMps } : {},
  );
  return {
    distance: formatDistance(estimate.distanceM, units),
    time: formatDurationS(estimate.timeS),
    waypoints: estimate.waypointCount,
  };
}
