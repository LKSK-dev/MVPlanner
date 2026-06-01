/**
 * Shared numeric/coordinate helpers for mission file I/O (task T4.9; spec
 * plan/04 §4.3, plan/07 §7.6).
 *
 * MAVLink `MISSION_ITEM_INT` (and therefore {@link import('../../contracts').MissionItem})
 * stores latitude/longitude as **integer degrees × 1e7** in `x`/`y`. Every
 * mission file format on disk (`QGC WPL 110`, QGroundControl `.plan`, KML, GPX)
 * instead stores plain **decimal degrees**. These helpers convert between the
 * two representations using integer arithmetic so the conversion is exact and
 * lossless across a parse → serialize round-trip.
 */

/** `MAV_CMD_NAV_WAYPOINT` — the command emitted by KML/GPX waypoint imports. */
export const MAV_CMD_NAV_WAYPOINT = 16;

/** `MAV_FRAME_GLOBAL_RELATIVE_ALT` — default frame for imported waypoints. */
export const MAV_FRAME_GLOBAL_RELATIVE_ALT = 3;

/** The 1e7 scale factor applied to latitude/longitude degrees. */
const E7 = 1e7;

/**
 * Convert decimal degrees to the integer `×1e7` form stored in a
 * {@link import('../../contracts').MissionItem} `x`/`y`.
 *
 * @param deg - Latitude or longitude in decimal degrees.
 * @returns The value scaled by 1e7 and rounded to the nearest integer.
 */
export function degToE7(deg: number): number {
  return Math.round(deg * E7);
}

/**
 * Convert an integer `×1e7` latitude/longitude back to decimal degrees as a
 * plain number (e.g. for the `.plan` JSON `params` array).
 *
 * @param e7 - The integer 1e7-scaled value.
 * @returns The value in decimal degrees.
 */
export function e7ToDeg(e7: number): number {
  return e7 / E7;
}

/**
 * Format an integer `×1e7` latitude/longitude as a decimal-degree **string**
 * with no floating-point drift (used by the `QGC WPL 110` text serializer).
 *
 * The fractional part is produced from the integer remainder, so the result is
 * the exact, shortest decimal that {@link degToE7} maps back to the same
 * integer.
 *
 * @param e7 - The integer 1e7-scaled value.
 * @returns A decimal string such as `-35.363261`.
 */
export function e7ToDegString(e7: number): string {
  const rounded = Math.round(e7);
  const sign = rounded < 0 ? '-' : '';
  const abs = Math.abs(rounded);
  const whole = Math.trunc(abs / E7);
  const frac = abs % E7;
  if (frac === 0) {
    return `${sign}${whole}`;
  }
  const fracStr = String(frac).padStart(7, '0').replace(/0+$/, '');
  return `${sign}${whole}.${fracStr}`;
}

/**
 * Format an arbitrary finite number as its shortest round-trippable decimal
 * string (used for command params and altitudes). `-0` is normalised to `0`.
 *
 * @param n - The value to format.
 * @returns The shortest decimal string `s` with `Number(s) === n`.
 */
export function formatNum(n: number): string {
  return Object.is(n, -0) ? '0' : String(n);
}

/**
 * Parse a whitespace/comma token to a finite number.
 *
 * @param token - The raw token.
 * @returns The parsed number, or `undefined` when it is not finite.
 */
export function parseFiniteNumber(token: string): number | undefined {
  const t = token.trim();
  if (t === '') {
    return undefined;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
