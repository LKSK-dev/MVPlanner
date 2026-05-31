/**
 * Locale-aware number/date formatter helpers (T0.8).
 *
 * Thin wrappers over the platform `Intl` APIs that default to the active locale
 * (spec plan/05 §5.9). Coordinate formatting and metric/imperial unit
 * conversion are intentionally **out of scope** here — they land in T3.8
 * (`src/geo/format`, `src/core/units`).
 */
import { getLocale } from './locale';

/** A timestamp accepted by the date helpers: a `Date` or epoch-milliseconds. */
export type DateInput = Date | number;

/** Format a number using `Intl.NumberFormat` in the active locale. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(getLocale(), options).format(value);
}

/** Format a whole number with no fraction digits, in the active locale. */
export function formatInteger(value: number): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

/** Format a number with a fixed number of fraction digits, in the active locale. */
export function formatDecimal(value: number, fractionDigits = 2): string {
  return formatNumber(value, {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

/** Format a date/time using `Intl.DateTimeFormat` in the active locale. */
export function formatDate(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(getLocale(), options).format(value);
}

/**
 * Format the time-of-day portion of a date in the active locale. When no
 * `options` are given a sensible default is used; otherwise the caller's
 * `options` are passed through verbatim (avoids `Intl` style/component clashes).
 */
export function formatTime(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  return formatDate(value, options ?? { timeStyle: 'medium' });
}

/**
 * Format both date and time in the active locale. When no `options` are given a
 * sensible default is used; otherwise the caller's `options` pass through.
 */
export function formatDateTime(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  return formatDate(value, options ?? { dateStyle: 'medium', timeStyle: 'short' });
}
