/**
 * Canonical decoded-field accessors shared by the MAVLink microservice clients.
 *
 * Extracted from the per-client `num` helpers, which were byte-for-byte
 * identical across the calibration, command, log, mission, param, and terrain
 * clients (no semantic reconciliation was needed): a `number` passes through
 * unchanged, a `bigint` is coerced via `Number(v)`, and every other value
 * (string, array, missing) yields `undefined`.
 */
import type { FieldValue } from '../../contracts';

/** Read a scalar field as a number (coercing bigint); `undefined` otherwise. */
export function numField(fields: Record<string, FieldValue>, key: string): number | undefined {
  const v = fields[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return undefined;
}
