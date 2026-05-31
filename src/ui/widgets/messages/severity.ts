/**
 * Pure MAV_SEVERITY → display-tier mapping for the STATUSTEXT console
 * (task T2.8; spec plan/04 §4.2, plan/05 §5.8). No DOM, no Solid — unit-tested
 * in isolation and reused by the component and by T2.11's wiring.
 *
 * MAV_SEVERITY (MAVLink common.xml) is most-severe-first:
 *
 * | value | name      | tier  | live region |
 * |-------|-----------|-------|-------------|
 * | 0     | EMERGENCY | error | assertive   |
 * | 1     | ALERT     | error | assertive   |
 * | 2     | CRITICAL  | error | assertive   |
 * | 3     | ERROR     | error | polite      |
 * | 4     | WARNING   | warn  | polite      |
 * | 5     | NOTICE    | warn  | polite      |
 * | 6     | INFO      | info  | polite      |
 * | 7     | DEBUG     | info  | polite      |
 *
 * Tiers collapse the eight levels onto the shared error/warn/info severity
 * system (spec plan/05 §5.6) so coloring tracks `--mvp-error/warn/ok`, while the
 * full level name + a non-color glyph stay available for the a11y cues required
 * by §5.8.
 */

/** Display tier — maps to the shared severity color system (error/warn/info). */
export type SeverityTier = 'error' | 'warn' | 'info';

/** Lowest valid MAV_SEVERITY value (EMERGENCY). */
export const MIN_SEVERITY = 0;
/** Highest valid MAV_SEVERITY value (DEBUG). */
export const MAX_SEVERITY = 7;

/** Severities at/below this are announced assertively (EMERGENCY/ALERT/CRITICAL). */
export const ASSERTIVE_MAX_SEVERITY = 2;

/** Short i18n key suffix per MAV_SEVERITY value (see {@link severityNameKey}). */
const SEVERITY_KEYS = [
  'emergency',
  'alert',
  'critical',
  'error',
  'warning',
  'notice',
  'info',
  'debug',
] as const;

/**
 * Clamp an arbitrary (possibly out-of-range or fractional) severity to a valid
 * integer MAV_SEVERITY value. Unknown inputs default to INFO so a stray frame
 * never silences itself or escalates to an emergency.
 */
export function clampSeverity(severity: number): number {
  if (!Number.isFinite(severity)) return 6;
  const v = Math.round(severity);
  if (v < MIN_SEVERITY) return MIN_SEVERITY;
  if (v > MAX_SEVERITY) return MAX_SEVERITY;
  return v;
}

/**
 * Map a MAV_SEVERITY value to its display {@link SeverityTier}.
 * `0..3` → `error`, `4..5` → `warn`, `6..7` → `info`.
 */
export function severityTier(severity: number): SeverityTier {
  const v = clampSeverity(severity);
  if (v <= 3) return 'error';
  if (v <= 5) return 'warn';
  return 'info';
}

/** True when `severity` should be announced via an assertive live region. */
export function isAssertiveSeverity(severity: number): boolean {
  return clampSeverity(severity) <= ASSERTIVE_MAX_SEVERITY;
}

/** i18n key for the full MAV_SEVERITY level name (e.g. `statustext.severity.critical`). */
export function severityNameKey(severity: number): string {
  return `statustext.severity.${SEVERITY_KEYS[clampSeverity(severity)]}`;
}

/** Non-color glyph cue per tier (rendered `aria-hidden`; the label carries the meaning). */
export function tierGlyph(tier: SeverityTier): string {
  switch (tier) {
    case 'error':
      return '\u26D4'; // ⛔ no-entry
    case 'warn':
      return '\u26A0'; // ⚠ warning sign
    case 'info':
      return '\u2139'; // ℹ information
  }
}

/** Rank a tier for filtering (`info` < `warn` < `error`). */
export function tierRank(tier: SeverityTier): number {
  switch (tier) {
    case 'info':
      return 0;
    case 'warn':
      return 1;
    case 'error':
      return 2;
  }
}
