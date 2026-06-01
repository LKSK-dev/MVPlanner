/**
 * Bounded undo/redo history for the waypoint table (task T4.3; spec plan/05 §5.7
 * "Undo: mission editing … support undo/redo before upload/write").
 *
 * Pure and generic over the snapshot type `T` (the table stores immutable
 * {@link import('../../../../geo/mission').MissionModel}s, so a snapshot is just
 * a reference). The history holds only the `past`/`future` stacks; the *present*
 * value lives in the controlled component and is passed in on each operation,
 * which keeps these helpers trivially testable.
 */

/** Immutable undo/redo stacks, oldest-first in `past`, newest-first in `future`. */
export interface History<T> {
  /** Snapshots before the present, oldest first. The last entry is the most recent. */
  readonly past: readonly T[];
  /** Snapshots after the present (from redo), nearest first. */
  readonly future: readonly T[];
}

/** Result of an undo/redo step: the new history and the value to make present. */
export interface HistoryStep<T> {
  /** The history after the step. */
  readonly history: History<T>;
  /** The snapshot that should become the present value. */
  readonly value: T;
}

/** An empty history (no undo/redo available). */
export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] };
}

/** Keep at most `limit` newest entries of an oldest-first stack. */
function capPast<T>(past: readonly T[], limit: number): readonly T[] {
  return past.length > limit ? past.slice(past.length - limit) : past;
}

/**
 * Record an edit: push the current `present` onto `past` (bounded to `limit`)
 * and clear the redo `future`. Call this *before* swapping in the new value.
 */
export function record<T>(history: History<T>, present: T, limit: number): History<T> {
  const max = Math.max(0, limit);
  if (max === 0) return { past: [], future: [] };
  return { past: capPast([...history.past, present], max), future: [] };
}

/** True when there is at least one snapshot to undo to. */
export function canUndo<T>(history: History<T>): boolean {
  return history.past.length > 0;
}

/** True when there is at least one snapshot to redo to. */
export function canRedo<T>(history: History<T>): boolean {
  return history.future.length > 0;
}

/**
 * Step back: make the most recent `past` snapshot the present and push the
 * current `present` onto `future`. Returns `undefined` when nothing to undo.
 */
export function undo<T>(history: History<T>, present: T): HistoryStep<T> | undefined {
  const { past, future } = history;
  if (past.length === 0) return undefined;
  const value = past[past.length - 1];
  if (value === undefined) return undefined;
  return {
    history: { past: past.slice(0, -1), future: [present, ...future] },
    value,
  };
}

/**
 * Step forward: make the nearest `future` snapshot the present and push the
 * current `present` onto `past`. Returns `undefined` when nothing to redo.
 */
export function redo<T>(history: History<T>, present: T, limit: number): HistoryStep<T> | undefined {
  const { past, future } = history;
  if (future.length === 0) return undefined;
  const value = future[0];
  if (value === undefined) return undefined;
  const max = Math.max(0, limit);
  return {
    history: { past: capPast([...past, present], max), future: future.slice(1) },
    value,
  };
}
