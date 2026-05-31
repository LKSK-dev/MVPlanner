/**
 * Bounded FIFO ring buffer for the inspector's recent-frame view (task T1.4).
 *
 * Keeps at most `capacity` items; pushing past capacity evicts the oldest so
 * memory stays bounded regardless of stream length (spec plan/03 §3.3).
 */
export class RingBuffer<T> {
  private readonly items: T[] = [];

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`ring capacity must be an integer >= 1, got ${capacity}`);
    }
  }

  /** Append an item, evicting the oldest if at capacity. */
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.shift();
    }
  }

  /** Snapshot copy, oldest → newest. */
  toArray(): T[] {
    return this.items.slice();
  }

  /** Number of retained items (≤ capacity). */
  get size(): number {
    return this.items.length;
  }
}
