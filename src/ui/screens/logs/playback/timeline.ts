/**
 * Pure tlog playback timeline state machine (task T6.6; spec plan/04 §4.7).
 *
 * This module holds the playback control logic — position, play/pause, speed,
 * and seek — as a set of PURE functions over an immutable {@link TimelineState}.
 * It has no Solid, DOM, or transport dependency, so it is exhaustively unit
 * testable on its own. The {@link import('./playback').PlaybackControls}
 * component keeps a {@link TimelineState} in a signal and maps user actions and
 * controller progress onto these reducers; the side effects (driving the real
 * {@link import('../../../../transport/replay').ReplayTransport}) live behind the
 * injected {@link import('./controller').PlaybackController} seam.
 */

import type { PlaybackProgress } from './controller';

/** Microseconds per second (tlog times are tracked in µs). */
const US_PER_SECOND = 1_000_000;

/** Slowest selectable playback speed (spec plan/04 §4.7: 0.1×–32×). */
export const MIN_SPEED = 0.1;
/** Fastest selectable playback speed (spec plan/04 §4.7: 0.1×–32×). */
export const MAX_SPEED = 32;

/** The canonical speed steps offered by the speed selector (0.1×–32×). */
export const PLAYBACK_SPEEDS: readonly number[] = [0.1, 0.25, 0.5, 1, 2, 4, 8, 16, 32];

/** Immutable snapshot of the playback timeline. */
export interface TimelineState {
  /** Total log duration in microseconds (0 until a tlog is loaded). */
  readonly totalUs: number;
  /** Current playback position in microseconds, in `[0, totalUs]`. */
  readonly positionUs: number;
  /** Whether playback is advancing (true) or paused (false). */
  readonly playing: boolean;
  /** Active playback speed multiplier, clamped to `[MIN_SPEED, MAX_SPEED]`. */
  readonly speed: number;
  /** True once playback has reached the end of the log. */
  readonly ended: boolean;
}

/** Clamp `n` into the inclusive `[lo, hi]` range. */
function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/** Clamp an arbitrary speed request into the supported `[0.1, 32]` range. */
export function clampSpeed(n: number): number {
  return clamp(n, MIN_SPEED, MAX_SPEED);
}

/** Clamp a position request into `[0, totalUs]`. */
export function clampPosition(positionUs: number, totalUs: number): number {
  return clamp(positionUs, 0, Math.max(0, totalUs));
}

/** Build the initial paused timeline for a log of `totalUs` microseconds. */
export function initialTimeline(totalUs = 0): TimelineState {
  const total = Math.max(0, Number.isFinite(totalUs) ? totalUs : 0);
  return { totalUs: total, positionUs: 0, playing: false, speed: 1, ended: false };
}

/** Update the known total duration (e.g. once the tlog is parsed). */
export function withTotal(state: TimelineState, totalUs: number): TimelineState {
  const total = Math.max(0, Number.isFinite(totalUs) ? totalUs : 0);
  return { ...state, totalUs: total, positionUs: clampPosition(state.positionUs, total) };
}

/** Begin (or resume) playback. No-op semantics once at end (stays ended). */
export function play(state: TimelineState): TimelineState {
  if (state.ended) return state;
  return { ...state, playing: true };
}

/** Pause playback at the current position. */
export function pause(state: TimelineState): TimelineState {
  return { ...state, playing: false };
}

/** Toggle between {@link play} and {@link pause}. */
export function togglePlay(state: TimelineState): TimelineState {
  return state.playing ? pause(state) : play(state);
}

/** Apply a new playback speed, clamped to the supported range. */
export function setSpeed(state: TimelineState, speed: number): TimelineState {
  return { ...state, speed: clampSpeed(speed) };
}

/**
 * Seek to `positionUs` (clamped to `[0, totalUs]`). Seeking clears the `ended`
 * flag when the target is before the end so playback can continue.
 */
export function seek(state: TimelineState, positionUs: number): TimelineState {
  const next = clampPosition(positionUs, state.totalUs);
  const ended = state.totalUs > 0 && next >= state.totalUs;
  return { ...state, positionUs: next, ended };
}

/** Mark that a single-frame step happened: step always leaves playback paused. */
export function stepped(state: TimelineState): TimelineState {
  return { ...state, playing: false };
}

/**
 * Fold a controller {@link PlaybackProgress} report into the timeline. Updates
 * the position (and total, if the controller now knows it) and flips `playing`
 * off when the stream has ended.
 */
export function withProgress(state: TimelineState, progress: PlaybackProgress): TimelineState {
  const total = progress.totalUs > 0 ? Math.max(state.totalUs, progress.totalUs) : state.totalUs;
  const positionUs = clampPosition(progress.positionUs, total);
  return {
    ...state,
    totalUs: total,
    positionUs,
    ended: progress.ended,
    playing: progress.ended ? false : state.playing,
  };
}

/**
 * Format a microsecond timestamp as `m:ss` (or `h:mm:ss` past an hour) for the
 * current-time / total-time readout. Negative or non-finite inputs render `0:00`.
 */
export function formatTimecode(us: number): string {
  const totalSeconds = Number.isFinite(us) ? Math.max(0, Math.floor(us / US_PER_SECOND)) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) {
    const mm = String(minutes).padStart(2, '0');
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}
