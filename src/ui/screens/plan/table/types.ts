/**
 * Public types for the waypoint table screen (task T4.3; spec plan/04 §4.3
 * table, plan/05 §5.4 Plan).
 *
 * The table is a **controlled** view over a `geo/mission` {@link MissionModel}:
 * the parent owns the model (`model()`) and receives every edit through
 * `onChange`. Row derivation ({@link WaypointRow}) and the undo stack are pure
 * (see `./rows`, `./undo`) so the heavy logic unit-tests without a DOM.
 */
import type { AltFrame, MavCmdMeta, MissionModel } from '../../../../geo/mission';
import type { UnitSystem } from '../../../../contracts';
import type { TFn } from '../../../../core/i18n';

export type { AltFrame, MavCmdMeta, MissionModel } from '../../../../geo/mission';
export type { UnitSystem } from '../../../../contracts';

export type { TFn };

/**
 * A flattened, display-ready view of one mission item. Pure projection of a
 * {@link import('../../../../geo/mission').MissionItemModel} (plus its index and
 * the model's `currentSeq`); rendered directly by the table rows.
 */
export interface WaypointRow {
  /** Zero-based sequence (the wire `seq`, and the array index). */
  seq: number;
  /** `MAV_CMD` command id. */
  command: number;
  /** Short command name (e.g. `NAV_WAYPOINT`), or the numeric id when unknown. */
  commandName: string;
  /** Raw `MAV_FRAME` value. */
  frame: number;
  /** Semantic altitude frame derived from {@link frame}. */
  altFrame: AltFrame;
  /** Latitude in WGS84 degrees. */
  lat: number;
  /** Longitude in WGS84 degrees. */
  lon: number;
  /** Altitude / `z`. */
  alt: number;
  /** `param1..param4`. */
  params: readonly [number, number, number, number];
  /** `autocontinue` flag. */
  autocontinue: boolean;
  /** True when this is the active/current item (`model.currentSeq`). */
  isCurrent: boolean;
  /** True when the command carries a usable geographic position. */
  hasPosition: boolean;
}

/** Formatted mission totals for the table header (units-aware). */
export interface WaypointTotals {
  /** Total ground distance, already unit-formatted (e.g. `1.23 km`). */
  distance: string;
  /** Total flight time, formatted as `m:ss` / `h:mm:ss`. */
  time: string;
  /** Number of position-bearing waypoints. */
  waypoints: number;
}

/** {@link WaypointTable} props. */
export interface WaypointTableProps {
  /** Reactive accessor for the controlled mission model. */
  model: () => MissionModel;
  /** Fired with the next model after any edit / undo / redo. */
  onChange: (next: MissionModel) => void;
  /** i18n translate function (default the app `t`). */
  t?: TFn;
  /** Reactive accessor for the unit system used to format totals (default metric). */
  units?: () => UnitSystem;
  /** Commands offered by the per-row picker (default the curated mission set). */
  commands?: readonly MavCmdMeta[];
  /** Cruise speed (m/s) for the time estimate (default the model helper's). */
  cruiseSpeedMps?: number;
  /** Maximum undo/redo depth (default {@link DEFAULT_UNDO_LIMIT}). */
  undoLimit?: number;
}

/** Default bounded undo/redo depth. */
export const DEFAULT_UNDO_LIMIT = 50;
