/**
 * Guest-local `ctx` utilities (task T7.3; spec plan/06 §6.4 "Lifecycle &
 * utilities").
 *
 * `ctx.log`, `ctx.events` and `ctx.timers` are NOT brokered — they need no
 * privilege and (over RPC) carry functions that cannot cross the structured
 * clone boundary, so they are provided locally. `ctx.timers` is built directly
 * from the per-extension {@link import('../host').DisposeRegistry} (tracked +
 * auto-cleared); this module provides the shared inter-extension event bus and
 * the per-extension console logger.
 */

/** The inter-extension event bus surface (`ctx.events`). */
export interface EventsBus {
  on(topic: string, cb: (p: unknown) => void): () => void;
  emit(topic: string, p: unknown): void;
}

/** A per-extension console sink (`ctx.log`), routed to the extension console. */
export interface ExtLogSink {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

/** A console-shaped target the default {@link makeLogSink} writes to. */
export interface ConsoleLike {
  info(...a: unknown[]): void;
  warn(...a: unknown[]): void;
  error(...a: unknown[]): void;
}

/**
 * Create a shared, in-memory event bus for `ctx.events`. Topics are plain
 * strings (callers namespace their own); a throwing subscriber is isolated so it
 * never blocks the rest. Fully synchronous and side-effect free outside its own
 * subscriber set, so it unit-tests without globals.
 */
export function createEventsBus(): EventsBus {
  const topics = new Map<string, Set<(p: unknown) => void>>();
  return {
    on(topic, cb): () => void {
      let set = topics.get(topic);
      if (!set) {
        set = new Set<(p: unknown) => void>();
        topics.set(topic, set);
      }
      set.add(cb);
      return (): void => {
        set.delete(cb);
        if (set.size === 0) topics.delete(topic);
      };
    },
    emit(topic, p): void {
      const set = topics.get(topic);
      if (!set) return;
      for (const cb of [...set]) {
        try {
          cb(p);
        } catch {
          /* isolate subscriber faults so one bad listener never blocks others */
        }
      }
    },
  };
}

/** Build a `ctx.log` sink that prefixes every line with the extension id. */
export function makeLogSink(extId: string, target: ConsoleLike = console): ExtLogSink {
  const tag = `[ext:${extId}]`;
  return {
    info: (...a: unknown[]): void => target.info(tag, ...a),
    warn: (...a: unknown[]): void => target.warn(tag, ...a),
    error: (...a: unknown[]): void => target.error(tag, ...a),
  };
}
