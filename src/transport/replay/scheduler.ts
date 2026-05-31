/**
 * Injectable timer abstraction for the replay transport.
 *
 * The replay scheduler is the only source of timing in the transport, so making
 * it injectable lets unit tests drive playback deterministically (either with a
 * manual scheduler or `vi.useFakeTimers()`), independent of wall-clock time.
 */

/** Opaque handle returned by {@link Scheduler.setTimeout}. */
export type TimeoutHandle = ReturnType<typeof setTimeout>;

/** A minimal `setTimeout`-like timer source. */
export interface Scheduler {
  /** Schedule `handler` to run after `delayMs` milliseconds. */
  setTimeout(handler: () => void, delayMs: number): TimeoutHandle;
  /** Cancel a previously scheduled handler. */
  clearTimeout(handle: TimeoutHandle): void;
}

/** Default scheduler backed by the ambient `setTimeout`/`clearTimeout`. */
export const defaultScheduler: Scheduler = {
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: (handle) => {
    clearTimeout(handle);
  },
};
