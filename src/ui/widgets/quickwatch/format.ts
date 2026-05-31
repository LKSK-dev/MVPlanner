/**
 * Value formatting for the Quick-watch widget (task T2.9). Pure + locale-light:
 * the widget shows raw numeric samples (units belong to the inspector/HUD), so
 * this only trims float noise while keeping integers exact.
 */

/** Decimal places used when rendering non-integer samples. */
const FLOAT_DP = 3;

/**
 * Human-readable string for a watched numeric sample. Integers render exactly;
 * non-integers are fixed to {@link FLOAT_DP} places with trailing zeros trimmed.
 * Non-finite inputs render as an em dash.
 */
export function formatWatchValue(value: number): string {
  if (!Number.isFinite(value)) return '\u2014';
  if (Number.isInteger(value)) return value.toString();
  const fixed = value.toFixed(FLOAT_DP);
  // Trim trailing zeros / a dangling dot without re-introducing float error.
  return fixed.replace(/\.?0+$/, '');
}
