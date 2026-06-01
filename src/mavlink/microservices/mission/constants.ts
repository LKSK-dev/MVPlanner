/**
 * MAVLink message identifiers and `MAV_MISSION_TYPE` / `MAV_MISSION_RESULT`
 * enum values used by the {@link MissionClient} (task T4.1; spec plan/03 §3.4
 * Mission).
 *
 * Values are resolved from the bundled `common` {@link DialectTable} so there is
 * a single source of truth, with the frozen MAVLink literal as a fallback for
 * the rare case a value is absent from the table. Message ids and enum values
 * are protocol constants and never change, so the literals double as
 * documentation of the exact wire ids this client emits.
 */
import type { DialectTable, MissionType } from '../../../contracts';
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

/** `MISSION_REQUEST_LIST` (43) — ask for the item count of a mission type. */
export const MSG_MISSION_REQUEST_LIST = msgId(commonDialect, 'MISSION_REQUEST_LIST', 43);
/** `MISSION_COUNT` (44) — item count reply (and the upload kick-off). */
export const MSG_MISSION_COUNT = msgId(commonDialect, 'MISSION_COUNT', 44);
/** `MISSION_REQUEST_INT` (51) — request a single item (int lat/lon) by seq. */
export const MSG_MISSION_REQUEST_INT = msgId(commonDialect, 'MISSION_REQUEST_INT', 51);
/** `MISSION_REQUEST` (40) — legacy float-coord item request by seq. */
export const MSG_MISSION_REQUEST = msgId(commonDialect, 'MISSION_REQUEST', 40);
/** `MISSION_ITEM_INT` (73) — a single item with int lat/lon in `x`/`y`. */
export const MSG_MISSION_ITEM_INT = msgId(commonDialect, 'MISSION_ITEM_INT', 73);
/** `MISSION_ACK` (47) — terminal handshake ack carrying a `MAV_MISSION_RESULT`. */
export const MSG_MISSION_ACK = msgId(commonDialect, 'MISSION_ACK', 47);
/** `MISSION_CLEAR_ALL` (45) — wipe all items of a mission type. */
export const MSG_MISSION_CLEAR_ALL = msgId(commonDialect, 'MISSION_CLEAR_ALL', 45);
/** `MISSION_SET_CURRENT` (41) — jump the active mission to a sequence. */
export const MSG_MISSION_SET_CURRENT = msgId(commonDialect, 'MISSION_SET_CURRENT', 41);
/** `MISSION_CURRENT` (42) — the vehicle's current active sequence. */
export const MSG_MISSION_CURRENT = msgId(commonDialect, 'MISSION_CURRENT', 42);
/** `MISSION_ITEM_REACHED` (46) — emitted when a waypoint is reached. */
export const MSG_MISSION_ITEM_REACHED = msgId(commonDialect, 'MISSION_ITEM_REACHED', 46);

// --- MAV_MISSION_TYPE ------------------------------------------------------

/** `MAV_MISSION_TYPE` values for the three supported mission storages. */
export const MAV_MISSION_TYPE = {
  MISSION: enumVal(commonDialect, 'MAV_MISSION_TYPE', 'MAV_MISSION_TYPE_MISSION', 0),
  FENCE: enumVal(commonDialect, 'MAV_MISSION_TYPE', 'MAV_MISSION_TYPE_FENCE', 1),
  RALLY: enumVal(commonDialect, 'MAV_MISSION_TYPE', 'MAV_MISSION_TYPE_RALLY', 2),
} as const;

/** Map the frozen {@link MissionType} string to its `MAV_MISSION_TYPE` value. */
export function missionTypeValue(type: MissionType): number {
  switch (type) {
    case 'mission':
      return MAV_MISSION_TYPE.MISSION;
    case 'fence':
      return MAV_MISSION_TYPE.FENCE;
    case 'rally':
      return MAV_MISSION_TYPE.RALLY;
  }
}

// --- MAV_MISSION_RESULT ----------------------------------------------------

/** `MAV_MISSION_ACCEPTED` (0) — the only non-error `MISSION_ACK.type`. */
export const MAV_MISSION_ACCEPTED = enumVal(
  commonDialect,
  'MAV_MISSION_RESULT',
  'MAV_MISSION_ACCEPTED',
  0,
);

/** Human label for a `MAV_MISSION_RESULT` value (for error messages). */
export function missionResultName(result: number): string {
  return (
    commonDialect.enums.MAV_MISSION_RESULT?.find((e) => e.value === result)?.name ??
    `MAV_MISSION_RESULT(${result})`
  );
}
