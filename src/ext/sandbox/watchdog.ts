/**
 * Sandbox CPU/loop watchdog (task T7.2; spec plan/06 §6.6 "runaway extensions
 * are throttled/paused", plan/08 §8.3).
 *
 * A heartbeat-based deadman timer. The guest is expected to {@link beat} (via a
 * liveness heartbeat over RPC) at least every `timeoutMs`; if a beat is overdue
 * the watchdog trips and calls {@link WatchdogOptions.onTimeout} exactly once —
 * the sandbox runtime wires that to `terminate()` the runaway Worker. A guest
 * spinning in a tight CPU loop never gets to send a heartbeat, so it is
 * terminated rather than wedging the host.
 *
 * Timer hooks are injectable so the trip is deterministic in unit tests without
 * real time (the real-Worker liveness path is browser-deferred, like the MAVLink
 * host worker).
 */

/** Construction options for {@link SandboxWatchdog}. */
export interface WatchdogOptions {
  /** Max time between heartbeats before the guest is considered runaway (ms). */
  timeoutMs: number;
  /** Called once when a heartbeat is overdue (wire to terminate the worker). */
  onTimeout: () => void;
  /** Timer scheduler (defaults to {@link setTimeout}); injectable for tests. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  /** Timer canceller (defaults to {@link clearTimeout}); injectable for tests. */
  clearTimer?: (handle: unknown) => void;
}

/** A heartbeat deadman timer that fires {@link WatchdogOptions.onTimeout} once. */
export class SandboxWatchdog {
  readonly #timeoutMs: number;
  readonly #onTimeout: () => void;
  readonly #setTimer: (fn: () => void, ms: number) => unknown;
  readonly #clearTimer: (handle: unknown) => void;
  #handle: unknown = undefined;
  #stopped = false;
  #fired = false;

  constructor(opts: WatchdogOptions) {
    this.#timeoutMs = opts.timeoutMs;
    this.#onTimeout = opts.onTimeout;
    this.#setTimer = opts.setTimer ?? ((fn, ms): unknown => setTimeout(fn, ms));
    this.#clearTimer =
      opts.clearTimer ?? ((handle): void => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** Whether the watchdog has tripped. */
  get tripped(): boolean {
    return this.#fired;
  }

  /** Arm the timer (call once the guest is live). */
  start(): void {
    this.#arm();
  }

  /** Record a heartbeat: re-arm the timer. No-op once stopped or tripped. */
  beat(): void {
    if (this.#stopped || this.#fired) return;
    this.#arm();
  }

  /** Disarm permanently (deactivate / dispose / after a trip). */
  stop(): void {
    this.#stopped = true;
    this.#disarm();
  }

  #arm(): void {
    this.#disarm();
    if (this.#stopped || this.#fired) return;
    this.#handle = this.#setTimer((): void => this.#trip(), this.#timeoutMs);
  }

  #disarm(): void {
    if (this.#handle !== undefined) {
      this.#clearTimer(this.#handle);
      this.#handle = undefined;
    }
  }

  #trip(): void {
    if (this.#stopped || this.#fired) return;
    this.#fired = true;
    this.#handle = undefined;
    this.#onTimeout();
  }
}
