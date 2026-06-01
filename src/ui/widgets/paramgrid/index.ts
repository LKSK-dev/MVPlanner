/**
 * `ui/widgets/paramgrid` public surface (task T3.4; spec plan/04 §4.5,
 * plan/05 §5.4 Config / §5.5 ParamGrid).
 *
 * A reusable, controlled parameter table: flat + grouped-tree views,
 * name/description search, sortable columns, type-aware editors (float / int /
 * enum / bitmask) from {@link import('../../../contracts').ParamMeta}, with
 * modified and out-of-range highlighting. It owns no client and no values — the
 * workbench (`src/ui/screens/config/params`) injects the base params, the
 * staged-edit map and a {@link ParamMetaResolver}.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3).
 *
 * @see ./README.md for the data contract, the editor matrix, and how to test.
 */
export { ParamGrid, MAX_VISIBLE_ROWS, type ParamGridProps } from './paramgrid';
export {
  isIntegerParamType,
  editorKindFor,
  groupPrefix,
  effectiveValue,
  isModified,
  isOutOfRange,
  buildRows,
  filterRows,
  sortRows,
  groupRows,
  parseEditorValue,
  hasBit,
  toggleBit,
  bitmaskEntries,
  enumEntries,
} from './model';
export { computeDiff, toValueMap, type DiffRow, type ParamSetInput } from './diff';
export { registerParamGridMessages, PARAM_GRID_MESSAGES } from './messages';
export type {
  EditorKind,
  GridView,
  Param,
  ParamGroup,
  ParamMeta,
  ParamMetaResolver,
  ParamRow,
  SortDir,
  SortKey,
  TFn,
} from './types';
