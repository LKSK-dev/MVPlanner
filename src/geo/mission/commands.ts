/**
 * Dialect-driven `MAV_CMD` metadata catalog (task T4.2; spec plan/04 §4.3
 * "per-command parameter editors driven by dialect metadata", plan/03 §3.1).
 * Pure; reads the (import-only) bundled {@link DialectTable}s.
 *
 * Every `MAV_CMD` enum entry in the dialect carries up to seven per-parameter
 * labels (`param1..param4` then `x`/`y`/`z`). This module normalises those into
 * a {@link MavCmdMeta} the mission model uses (to know which commands carry a
 * position) and the command editor/picker render from (labels + grouping).
 */
import type { DialectTable } from '../../contracts';
import { BUILTIN_DIALECTS } from '../../mavlink/dialects';

/** Number of editable slots on a mission command: `param1..param4`, `x`, `y`, `z`. */
export const MAV_CMD_PARAM_COUNT = 7;

/** Index of the `x` (latitude) slot within a {@link MavCmdMeta.params} array. */
export const PARAM_INDEX_X = 4;
/** Index of the `y` (longitude) slot. */
export const PARAM_INDEX_Y = 5;
/** Index of the `z` (altitude) slot. */
export const PARAM_INDEX_Z = 6;

/** Coarse grouping used by the command picker (spec plan/04 §4.3). */
export type MavCmdCategory = 'NAV' | 'DO' | 'CONDITION' | 'OTHER';

/** Normalised metadata for one `MAV_CMD` entry. */
export interface MavCmdMeta {
  /** Numeric `MAV_CMD` value (e.g. 16). */
  value: number;
  /** Full enum name (e.g. `MAV_CMD_NAV_WAYPOINT`). */
  name: string;
  /** Name with the `MAV_CMD_` prefix stripped (e.g. `NAV_WAYPOINT`). */
  shortName: string;
  /** Long description from the dialect, when present. */
  description?: string;
  /** Picker grouping derived from the name prefix. */
  category: MavCmdCategory;
  /**
   * Seven per-slot labels: `param1..param4`, then `x`, `y`, `z`. An empty
   * string means the slot is unused by this command (editors hide or grey it).
   */
  params: readonly [string, string, string, string, string, string, string];
  /** True when the command's `x`/`y` slots are a geographic latitude/longitude. */
  hasPosition: boolean;
}

const MAV_CMD_ENUM = 'MAV_CMD';
const NAME_PREFIX = 'MAV_CMD_';

function categoryOf(shortName: string): MavCmdCategory {
  if (shortName.startsWith('NAV_')) return 'NAV';
  if (shortName.startsWith('DO_')) return 'DO';
  if (shortName.startsWith('CONDITION_')) return 'CONDITION';
  return 'OTHER';
}

/** Pad/trim a dialect label list to exactly {@link MAV_CMD_PARAM_COUNT} slots. */
function normaliseParams(
  labels: readonly string[] | undefined,
): [string, string, string, string, string, string, string] {
  const out: [string, string, string, string, string, string, string] = [
    '',
    '',
    '',
    '',
    '',
    '',
    '',
  ];
  if (!labels) return out;
  for (let i = 0; i < MAV_CMD_PARAM_COUNT; i++) {
    const label = labels[i];
    if (label !== undefined) out[i] = label;
  }
  return out;
}

function positionFromParams(
  params: readonly [string, string, string, string, string, string, string],
): boolean {
  const x = params[PARAM_INDEX_X];
  const y = params[PARAM_INDEX_Y];
  return /lat/i.test(x) && /lon/i.test(y);
}

/**
 * Build a `value → {@link MavCmdMeta}` catalog from `dialects`. Earlier dialects
 * win on conflicting entries (bundled order is `common` then `ardupilotmega`,
 * matching the inspector's enum decoder).
 */
export function buildCommandCatalog(
  dialects: readonly DialectTable[],
): ReadonlyMap<number, MavCmdMeta> {
  const out = new Map<number, MavCmdMeta>();
  for (const d of dialects) {
    const entries = d.enums[MAV_CMD_ENUM];
    if (!entries) continue;
    for (const e of entries) {
      if (out.has(e.value)) continue;
      const shortName = e.name.startsWith(NAME_PREFIX) ? e.name.slice(NAME_PREFIX.length) : e.name;
      const params = normaliseParams(e.params);
      const meta: MavCmdMeta = {
        value: e.value,
        name: e.name,
        shortName,
        category: categoryOf(shortName),
        params,
        hasPosition: positionFromParams(params),
      };
      if (e.description !== undefined) meta.description = e.description;
      out.set(e.value, meta);
    }
  }
  return out;
}

let defaultCatalog: ReadonlyMap<number, MavCmdMeta> | undefined;

/** The lazily-built catalog over {@link BUILTIN_DIALECTS}. */
export function defaultCommandCatalog(): ReadonlyMap<number, MavCmdMeta> {
  defaultCatalog ??= buildCommandCatalog(BUILTIN_DIALECTS);
  return defaultCatalog;
}

/** Metadata for one `MAV_CMD` value from the default catalog (if known). */
export function commandMeta(command: number): MavCmdMeta | undefined {
  return defaultCommandCatalog().get(command);
}

/**
 * True when a command's `x`/`y` are a geographic position and so should be
 * counted toward the mission's ground-distance estimate. Falls back to a small
 * set of well-known position-bearing NAV commands when the dialect lacks the
 * entry, so estimates stay correct even for a minimal dialect.
 */
export function commandHasPosition(command: number): boolean {
  const meta = commandMeta(command);
  if (meta) return meta.hasPosition;
  return FALLBACK_POSITION_COMMANDS.has(command);
}

/**
 * Well-known position-bearing NAV command ids, used only when the active
 * dialect has no metadata for a command (keeps distance estimates correct
 * against a stripped-down dialect).
 */
const FALLBACK_POSITION_COMMANDS: ReadonlySet<number> = new Set([
  16, // NAV_WAYPOINT
  17, // NAV_LOITER_UNLIM
  18, // NAV_LOITER_TURNS
  19, // NAV_LOITER_TIME
  21, // NAV_LAND
  22, // NAV_TAKEOFF
  82, // NAV_SPLINE_WAYPOINT
]);
