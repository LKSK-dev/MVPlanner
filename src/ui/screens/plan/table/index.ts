/**
 * `ui/screens/plan/table` public surface (task T4.3; spec plan/04 §4.3 table,
 * plan/05 §5.4 Plan, §5.7 undo).
 *
 * An editable, spreadsheet-like **waypoint table** over the `geo/mission`
 * {@link MissionModel}. Controlled via `model()` + `onChange`, with per-row
 * command / frame / lat / lon / alt / current editing, insert / delete /
 * reorder, default altitude, units-formatted distance / time / waypoint totals,
 * and a bounded undo / redo stack. Pure row derivation (`./rows`) and undo logic
 * (`./undo`) are exported for reuse/testing. Cross-module consumers import from
 * here, never deep paths (conventions plan/implementation/00 §0.3). Importing
 * this module registers the `plan.table.*` i18n strings as a side effect.
 *
 * @see ./README.md for the API and how the Plan assembly wires it.
 */
import './messages';

export { WaypointTable } from './wp-table';
export {
  createWaypointTablePanel,
  WP_TABLE_PANEL_ID,
  type WaypointTablePanelDeps,
} from './register';
export { WP_TABLE_MESSAGES, registerWpTableMessages } from './messages';
export { toRows, missionTotals, formatDurationS, type TotalsOptions } from './rows';
export {
  emptyHistory,
  record,
  undo,
  redo,
  canUndo,
  canRedo,
  type History,
  type HistoryStep,
} from './undo';
export {
  DEFAULT_UNDO_LIMIT,
  type WaypointTableProps,
  type WaypointRow,
  type WaypointTotals,
  type TFn,
} from './types';
