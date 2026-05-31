/**
 * MAVLink command / enum identifiers used by the {@link CommandClient}
 * (task T2.5/T2.6; spec plan/03 §3.4 Command + Mode/Arm).
 *
 * Values are resolved from the bundled `common` {@link DialectTable} so there is
 * a single source of truth, with the frozen MAVLink literal as a fallback for
 * the rare case a value is absent from the table. MAVLink message/command ids
 * are protocol constants and never change, so the literals double as
 * documentation of the exact wire ids this client emits.
 */
import type { DialectTable } from '../../../contracts';
import { commonDialect } from '../../dialects';

/** Resolve a `MAV_CMD` entry value by name, falling back to `fallback`. */
function cmdId(d: DialectTable, name: string, fallback: number): number {
  return d.enums.MAV_CMD?.find((e) => e.name === name)?.value ?? fallback;
}

/** Resolve an arbitrary enum entry value by name, falling back to `fallback`. */
function enumVal(d: DialectTable, enumName: string, name: string, fallback: number): number {
  return d.enums[enumName]?.find((e) => e.name === name)?.value ?? fallback;
}

/** Resolve a message id by name, falling back to `fallback`. */
function msgId(d: DialectTable, name: string, fallback: number): number {
  for (const m of Object.values(d.messages)) if (m.name === name) return m.id;
  return fallback;
}

// --- MAV_CMD ids -----------------------------------------------------------

/** `MAV_CMD_COMPONENT_ARM_DISARM` — arm/disarm (carried in a COMMAND_LONG). */
export const CMD_COMPONENT_ARM_DISARM = cmdId(commonDialect, 'MAV_CMD_COMPONENT_ARM_DISARM', 400);
/** `MAV_CMD_DO_SET_MODE` — set base/custom flight mode. */
export const CMD_DO_SET_MODE = cmdId(commonDialect, 'MAV_CMD_DO_SET_MODE', 176);
/** `MAV_CMD_NAV_TAKEOFF` — take off to `param7` altitude. */
export const CMD_NAV_TAKEOFF = cmdId(commonDialect, 'MAV_CMD_NAV_TAKEOFF', 22);
/** `MAV_CMD_NAV_LAND` — land at the current (or param5/6) location. */
export const CMD_NAV_LAND = cmdId(commonDialect, 'MAV_CMD_NAV_LAND', 21);
/** `MAV_CMD_DO_SET_ROI_LOCATION` — point the vehicle/gimbal at a location. */
export const CMD_DO_SET_ROI_LOCATION = cmdId(commonDialect, 'MAV_CMD_DO_SET_ROI_LOCATION', 195);
/** `MAV_CMD_DO_SET_ROI_NONE` — cancel any active region of interest. */
export const CMD_DO_SET_ROI_NONE = cmdId(commonDialect, 'MAV_CMD_DO_SET_ROI_NONE', 197);

// --- message ids -----------------------------------------------------------

/** `COMMAND_LONG` (76). */
export const MSG_COMMAND_LONG = msgId(commonDialect, 'COMMAND_LONG', 76);
/** `COMMAND_INT` (75). */
export const MSG_COMMAND_INT = msgId(commonDialect, 'COMMAND_INT', 75);
/** `COMMAND_ACK` (77) — the reply correlated by {@link CommandClient}. */
export const MSG_COMMAND_ACK = msgId(commonDialect, 'COMMAND_ACK', 77);
/** `SET_MODE` (11) — legacy mode-set fallback (no ACK). */
export const MSG_SET_MODE = msgId(commonDialect, 'SET_MODE', 11);
/** `SET_POSITION_TARGET_GLOBAL_INT` (86) — guided "fly here" setpoint. */
export const MSG_SET_POSITION_TARGET_GLOBAL_INT = msgId(
  commonDialect,
  'SET_POSITION_TARGET_GLOBAL_INT',
  86,
);
/** `MISSION_SET_CURRENT` (41) — jump the active mission sequence. */
export const MSG_MISSION_SET_CURRENT = msgId(commonDialect, 'MISSION_SET_CURRENT', 41);

// --- enums -----------------------------------------------------------------

/** `MAV_RESULT` values surfaced through the command state machine. */
export const MAV_RESULT = {
  ACCEPTED: enumVal(commonDialect, 'MAV_RESULT', 'MAV_RESULT_ACCEPTED', 0),
  TEMPORARILY_REJECTED: enumVal(commonDialect, 'MAV_RESULT', 'MAV_RESULT_TEMPORARILY_REJECTED', 1),
  DENIED: enumVal(commonDialect, 'MAV_RESULT', 'MAV_RESULT_DENIED', 2),
  UNSUPPORTED: enumVal(commonDialect, 'MAV_RESULT', 'MAV_RESULT_UNSUPPORTED', 3),
  FAILED: enumVal(commonDialect, 'MAV_RESULT', 'MAV_RESULT_FAILED', 4),
  IN_PROGRESS: enumVal(commonDialect, 'MAV_RESULT', 'MAV_RESULT_IN_PROGRESS', 5),
} as const;

/** Human label for a `MAV_RESULT` value (for error messages / diagnostics). */
export function resultName(result: number): string {
  return (
    commonDialect.enums.MAV_RESULT?.find((e) => e.value === result)?.name ?? `MAV_RESULT(${result})`
  );
}

/** `MAV_MODE_FLAG_CUSTOM_MODE_ENABLED` — base_mode bit for custom modes. */
export const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = enumVal(
  commonDialect,
  'MAV_MODE_FLAG',
  'MAV_MODE_FLAG_CUSTOM_MODE_ENABLED',
  1,
);

/** `MAV_FRAME_GLOBAL` — absolute (AMSL) lat/lon/alt frame. */
export const MAV_FRAME_GLOBAL = enumVal(commonDialect, 'MAV_FRAME', 'MAV_FRAME_GLOBAL', 0);
/** `MAV_FRAME_GLOBAL_RELATIVE_ALT_INT` — lat/lon int, alt relative to home. */
export const MAV_FRAME_GLOBAL_RELATIVE_ALT_INT = enumVal(
  commonDialect,
  'MAV_FRAME',
  'MAV_FRAME_GLOBAL_RELATIVE_ALT_INT',
  6,
);

/** `param2` magic value that forces an (dis)arm past pre-arm checks. */
export const ARM_FORCE_MAGIC = 21196;

/**
 * Position-only `type_mask` for {@link MSG_SET_POSITION_TARGET_GLOBAL_INT}: all
 * velocity / acceleration / yaw / yaw-rate components ignored (position used).
 */
export const POSITION_ONLY_TYPE_MASK =
  enumVal(commonDialect, 'POSITION_TARGET_TYPEMASK', 'POSITION_TARGET_TYPEMASK_VX_IGNORE', 8) |
  enumVal(commonDialect, 'POSITION_TARGET_TYPEMASK', 'POSITION_TARGET_TYPEMASK_VY_IGNORE', 16) |
  enumVal(commonDialect, 'POSITION_TARGET_TYPEMASK', 'POSITION_TARGET_TYPEMASK_VZ_IGNORE', 32) |
  enumVal(commonDialect, 'POSITION_TARGET_TYPEMASK', 'POSITION_TARGET_TYPEMASK_AX_IGNORE', 64) |
  enumVal(commonDialect, 'POSITION_TARGET_TYPEMASK', 'POSITION_TARGET_TYPEMASK_AY_IGNORE', 128) |
  enumVal(commonDialect, 'POSITION_TARGET_TYPEMASK', 'POSITION_TARGET_TYPEMASK_AZ_IGNORE', 256) |
  enumVal(commonDialect, 'POSITION_TARGET_TYPEMASK', 'POSITION_TARGET_TYPEMASK_YAW_IGNORE', 1024) |
  enumVal(
    commonDialect,
    'POSITION_TARGET_TYPEMASK',
    'POSITION_TARGET_TYPEMASK_YAW_RATE_IGNORE',
    2048,
  );

/** Scale factor for MAVLink `*_int` latitude/longitude fields (degrees → 1e7). */
export const LATLON_SCALE = 1e7;
