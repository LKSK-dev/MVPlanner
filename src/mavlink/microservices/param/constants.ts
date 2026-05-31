/**
 * MAVLink message identifiers and `MAV_PARAM_TYPE` values used by the
 * {@link ParamClient} (task T3.2; spec plan/03 §3.4 Parameters).
 *
 * Values are resolved from the bundled `common` {@link DialectTable} so there is
 * a single source of truth, with the frozen MAVLink literal as a fallback for
 * the rare case a value is absent from the table. Message ids and enum values
 * are protocol constants and never change, so the literals double as
 * documentation of the exact wire ids this client emits.
 */
import type { DialectTable } from '../../../contracts';
import { commonDialect } from '../../dialects';

/** Resolve a message id by name, falling back to `fallback`. */
function msgId(d: DialectTable, name: string, fallback: number): number {
  for (const m of Object.values(d.messages)) if (m.name === name) return m.id;
  return fallback;
}

/** Resolve an enum entry value by name, falling back to `fallback`. */
function enumVal(d: DialectTable, enumName: string, name: string, fallback: number): number {
  return d.enums[enumName]?.find((e) => e.name === name)?.value ?? fallback;
}

// --- message ids -----------------------------------------------------------

/** `PARAM_REQUEST_LIST` (21) — request the full parameter set. */
export const MSG_PARAM_REQUEST_LIST = msgId(commonDialect, 'PARAM_REQUEST_LIST', 21);
/** `PARAM_REQUEST_READ` (20) — request a single parameter by index or id. */
export const MSG_PARAM_REQUEST_READ = msgId(commonDialect, 'PARAM_REQUEST_READ', 20);
/** `PARAM_VALUE` (22) — the value reply correlated/collected by the client. */
export const MSG_PARAM_VALUE = msgId(commonDialect, 'PARAM_VALUE', 22);
/** `PARAM_SET` (23) — write a single parameter value. */
export const MSG_PARAM_SET = msgId(commonDialect, 'PARAM_SET', 23);

// --- MAV_PARAM_TYPE --------------------------------------------------------

/**
 * `MAV_PARAM_TYPE` values. ArduPilot (the primary firmware per spec plan/03)
 * treats `PARAM_VALUE.param_value` as the numeric value regardless of type and
 * largely ignores the `param_type` on `PARAM_SET`, so {@link REAL32} is the safe
 * default type for a write when the parameter is not yet cached.
 */
export const MAV_PARAM_TYPE = {
  UINT8: enumVal(commonDialect, 'MAV_PARAM_TYPE', 'MAV_PARAM_TYPE_UINT8', 1),
  INT8: enumVal(commonDialect, 'MAV_PARAM_TYPE', 'MAV_PARAM_TYPE_INT8', 2),
  UINT16: enumVal(commonDialect, 'MAV_PARAM_TYPE', 'MAV_PARAM_TYPE_UINT16', 3),
  INT16: enumVal(commonDialect, 'MAV_PARAM_TYPE', 'MAV_PARAM_TYPE_INT16', 4),
  UINT32: enumVal(commonDialect, 'MAV_PARAM_TYPE', 'MAV_PARAM_TYPE_UINT32', 5),
  INT32: enumVal(commonDialect, 'MAV_PARAM_TYPE', 'MAV_PARAM_TYPE_INT32', 6),
  UINT64: enumVal(commonDialect, 'MAV_PARAM_TYPE', 'MAV_PARAM_TYPE_UINT64', 7),
  INT64: enumVal(commonDialect, 'MAV_PARAM_TYPE', 'MAV_PARAM_TYPE_INT64', 8),
  REAL32: enumVal(commonDialect, 'MAV_PARAM_TYPE', 'MAV_PARAM_TYPE_REAL32', 9),
  REAL64: enumVal(commonDialect, 'MAV_PARAM_TYPE', 'MAV_PARAM_TYPE_REAL64', 10),
} as const;

/** `PARAM_REQUEST_READ.param_index` sentinel: look the parameter up by id. */
export const PARAM_INDEX_BY_ID = -1;

/** Maximum MAVLink `param_id` length (`char[16]`, NUL-terminated when shorter). */
export const PARAM_ID_LEN = 16;

/** `param_index` value some firmwares use when a value is not list-indexed. */
export const PARAM_INDEX_NONE = 0xffff;
