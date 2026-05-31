/**
 * Typed in-process publish/subscribe event bus (contract `src/contracts/bus.ts`
 * `EventBus`; impl 02 §2.1). Topics are plain strings; the generic `<T>` on
 * `on`/`emit` types the payload at the call site. Used for decoupled
 * intra-thread fan-out (worker↔worker host wiring uses {@link ./rpc!Rpc}).
 */
import type { EventBus } from '../../contracts';

type Listener = (payload: unknown) => void;

/** Default {@link EventBus} implementation backed by per-topic listener sets. */
export class TypedEventBus implements EventBus {
  private readonly topics = new Map<string, Set<Listener>>();

  /**
   * Subscribe `cb` to `topic`. Returns a disposer that removes exactly this
   * subscription; calling it more than once is a no-op.
   */
  on<T>(topic: string, cb: (payload: T) => void): () => void {
    // postMessage-free boundary: payloads are typed by the caller's `<T>`.
    const listener = cb as Listener;
    let set = this.topics.get(topic);
    if (!set) {
      set = new Set();
      this.topics.set(topic, set);
    }
    set.add(listener);
    return (): void => {
      const current = this.topics.get(topic);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.topics.delete(topic);
    };
  }

  /**
   * Synchronously deliver `payload` to every current subscriber of `topic`.
   * Iterates a snapshot so a listener may unsubscribe (or subscribe) during
   * delivery without affecting the in-flight emit.
   */
  emit<T>(topic: string, payload: T): void {
    const set = this.topics.get(topic);
    if (!set || set.size === 0) return;
    for (const listener of [...set]) listener(payload);
  }
}

/** Create a fresh {@link EventBus}. */
export function createEventBus(): EventBus {
  return new TypedEventBus();
}
