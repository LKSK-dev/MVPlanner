/**
 * Public types for the parameter grid widget (task T3.4; spec plan/04 §4.5,
 * plan/05 §5.4 Config / §5.5 ParamGrid).
 *
 * The grid is a controlled presentation component: it never owns a
 * {@link import('../../../contracts').ParamClient} or the param set. The
 * workbench (`src/ui/screens/config/params`) owns the fetched values and the
 * pending-edit staging buffer and hands them in through these structural seams,
 * so the grid is trivially testable with plain objects (no Worker, no host).
 */
import type { Param, ParamMeta } from '../../../contracts';

export type { Param, ParamMeta } from '../../../contracts';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/**
 * The minimal lookup the grid needs to render type-aware editors:
 * `name -> ParamMeta | undefined`. The real
 * {@link import('../../../mavlink/param-meta').ParamMetaStore} satisfies this
 * structurally through its `get` method; tests inject a one-method mock.
 */
export interface ParamMetaResolver {
  /** Metadata for `name`, or `undefined` when nothing is known. */
  get(name: string): ParamMeta | undefined;
}

/** Which editor a row renders, derived from {@link ParamMeta} + the wire type. */
export type EditorKind = 'float' | 'int' | 'enum' | 'bitmask';

/** Column the grid is sorted by. */
export type SortKey = 'name' | 'value';

/** Sort direction. */
export type SortDir = 'asc' | 'desc';

/** Flat vs grouped-tree presentation of the parameter list. */
export type GridView = 'flat' | 'tree';

/** A single parameter row enriched with resolved metadata + staged state. */
export interface ParamRow {
  /** The parameter (carrying the *vehicle/base* value). */
  readonly param: Param;
  /** Resolved metadata (resolver result, falling back to `param.meta`). */
  readonly meta: ParamMeta | undefined;
  /** Which editor to render. */
  readonly editor: EditorKind;
  /** Staged value if the user has edited this row, else `undefined`. */
  readonly pending: number | undefined;
  /** The value to display/edit: `pending ?? param.value`. */
  readonly effective: number;
  /** True when {@link pending} differs from the base value. */
  readonly modified: boolean;
  /** True when {@link effective} falls outside `meta.min`/`meta.max`. */
  readonly outOfRange: boolean;
}

/** A collapsible group of rows sharing a name prefix (up to the first `_`). */
export interface ParamGroup {
  /** Group key — the shared prefix (or the whole name when it has no `_`). */
  readonly prefix: string;
  /** Member rows (already sorted). */
  readonly rows: readonly ParamRow[];
  /** Count of modified members (for the group header badge). */
  readonly modifiedCount: number;
  /** Count of out-of-range members. */
  readonly outOfRangeCount: number;
}
