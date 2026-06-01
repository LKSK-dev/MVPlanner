/**
 * Dispose registry (task T7.1; spec plan/06 §6.3).
 *
 * The tracking primitive the per-extension `ctx` (T7.3) and the runtime use to
 * record cleanups: every `ctx.onDispose(fn)` registration and every tracked
 * timer is collected here and torn down — once, in LIFO order, with each
 * cleanup isolated — when the host deactivates / reloads the extension. This is
 * how "no leaks on disable/uninstall/reload" is guaranteed.
 */

const NOOP = (): void => {};

/** A set of teardown callbacks tied to one extension activation. */
export class DisposeRegistry {
  readonly #cleanups = new Set<() => void>();
  #disposed = false;

  /** Whether {@link dispose} has already run. */
  get disposed(): boolean {
    return this.#disposed;
  }

  /** Number of still-pending cleanups. */
  get size(): number {
    return this.#cleanups.size;
  }

  /**
   * Register a cleanup. Returns a handle that runs (and unregisters) just this
   * one cleanup. If the registry is already disposed, the cleanup runs at once.
   */
  add(cleanup: () => void): () => void {
    if (this.#disposed) {
      cleanup();
      return NOOP;
    }
    let active = true;
    const handle = (): void => {
      if (!active) return;
      active = false;
      this.#cleanups.delete(handle);
      cleanup();
    };
    this.#cleanups.add(handle);
    return handle;
  }

  /** Track a `setInterval`; returns a handle that clears + unregisters it. */
  setInterval(fn: () => void, ms: number): () => void {
    const id = setInterval(fn, ms);
    return this.add(() => clearInterval(id));
  }

  /** Track a single `requestAnimationFrame`; returns a cancel + unregister handle. */
  raf(fn: (time: number) => void): () => void {
    if (typeof requestAnimationFrame !== 'function') {
      return this.add(NOOP);
    }
    const id = requestAnimationFrame(fn);
    return this.add(() => cancelAnimationFrame(id));
  }

  /** Run every pending cleanup once (LIFO), isolating individual faults. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    const handles = [...this.#cleanups].reverse();
    this.#cleanups.clear();
    for (const handle of handles) {
      try {
        handle();
      } catch {
        /* isolate cleanup faults so one bad disposer never blocks the rest */
      }
    }
  }
}
