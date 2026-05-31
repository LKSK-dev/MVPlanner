/**
 * Pure `message.field` path helpers for the Quick-watch widget (task T2.9).
 *
 * The canonical string form of a {@link QuickWatchField} is `\`${msg}.${field}\``.
 * The FIRST dot separates the message name from the field name (MAVLink field
 * names never contain a dot), so a round-trip is lossless.
 */
import type { QuickWatchField } from './types';

/** Canonical `message.field` string for a watch path. */
export function pathOf(f: QuickWatchField): string {
  return `${f.msg}.${f.field}`;
}

/**
 * Parse a `message.field` string back into a {@link QuickWatchField}, or
 * `undefined` when it is malformed (no separating dot, or an empty side).
 */
export function parsePath(path: string): QuickWatchField | undefined {
  const i = path.indexOf('.');
  if (i <= 0 || i >= path.length - 1) return undefined;
  return { msg: path.slice(0, i), field: path.slice(i + 1) };
}

/** True when two watch paths reference the same `message.field`. */
export function samePath(a: QuickWatchField, b: QuickWatchField): boolean {
  return a.msg === b.msg && a.field === b.field;
}
