/**
 * Value / rate / last-seen formatting for the inspector (task T1.12; spec
 * plan/04 §4.9). Pure helpers; user-facing units are applied by the widget via
 * i18n templates so this module stays locale-agnostic.
 */
import type { FieldValue } from '../../../contracts';

/** Decimal places used when rendering non-integer float fields. */
const FLOAT_DP = 4;

/**
 * Human-readable string for one decoded MAVLink field value. `bigint`s (64-bit
 * fields) render exactly; non-integer floats are fixed to {@link FLOAT_DP}
 * places; numeric arrays (e.g. `char[]` / vectors) render comma-separated.
 */
export function formatFieldValue(v: FieldValue): string {
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `[${v.join(', ')}]`;
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(FLOAT_DP);
}

/** Observed rate as a short string (≥100 Hz drops the decimal). */
export function formatRate(hz: number): string {
  if (!Number.isFinite(hz) || hz <= 0) return '0';
  return hz >= 100 ? Math.round(hz).toString() : hz.toFixed(1);
}

/** A formatted last-seen age plus the i18n key carrying its unit. */
export interface AgeParts {
  /** Numeric magnitude as a string. */
  n: string;
  /** Catalog key for the unit template (`{n}` slot). */
  key: 'inspector.ageMs' | 'inspector.ageS';
}

/** Threshold (ms) above which an age is shown in seconds rather than ms. */
const AGE_SECONDS_THRESHOLD_MS = 1000;

/** Split a last-seen age (ms) into a magnitude + unit catalog key. */
export function formatAge(ageMs: number): AgeParts {
  const a = ageMs > 0 ? ageMs : 0;
  if (a < AGE_SECONDS_THRESHOLD_MS) {
    return { n: Math.round(a).toString(), key: 'inspector.ageMs' };
  }
  return { n: (a / 1000).toFixed(1), key: 'inspector.ageS' };
}
