/**
 * A bounded FIFO ring of recent numeric samples (task T2.9).
 *
 * Pure + framework-free so it is trivially unit-tested. The Quick-watch widget
 * keeps one {@link RingBuffer} per watched field and feeds it a sample whenever
 * the {@link import('./types').QuickWatchSource} reports new data; the sparkline
 * is then computed from {@link RingBuffer.toArray}. Once full, the oldest
 * samples are dropped so memory stays bounded regardless of stream rate.
 */
export class RingBuffer {
  /** Maximum number of samples retained. */
  readonly capacity: number;

  private buf: number[] = [];

  /**
   * @param capacity - Maximum retained samples; must be a positive integer.
   * @throws RangeError when `capacity` is not a positive integer.
   */
  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) {
      throw new RangeError('RingBuffer capacity must be a positive integer');
    }
    this.capacity = capacity;
  }

  /** Append a sample, evicting the oldest once {@link capacity} is exceeded. */
  push(value: number): void {
    this.buf.push(value);
    const overflow = this.buf.length - this.capacity;
    if (overflow > 0) this.buf.splice(0, overflow);
  }

  /** Number of samples currently retained (`0..capacity`). */
  get size(): number {
    return this.buf.length;
  }

  /** The most recent sample, or `undefined` when empty. */
  get last(): number | undefined {
    return this.buf.length > 0 ? this.buf[this.buf.length - 1] : undefined;
  }

  /** A copy of the retained samples, oldest → newest. */
  toArray(): readonly number[] {
    return this.buf.slice();
  }

  /** Drop all retained samples. */
  clear(): void {
    this.buf.length = 0;
  }
}
