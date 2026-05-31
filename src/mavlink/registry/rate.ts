/**
 * Sliding-window observed-rate estimator (task T1.4; spec plan/03 §3.3).
 *
 * Records arrival timestamps (in the registry's injected time domain) and
 * derives Hz from the samples currently inside the window. Memory is bounded by
 * both the window length and a hard sample cap.
 */
export class SlidingWindowRate {
  private readonly times: number[] = [];

  constructor(
    private readonly windowMs: number,
    private readonly maxSamples: number,
  ) {
    if (windowMs <= 0) {
      throw new RangeError(`rate window must be > 0, got ${windowMs}`);
    }
    if (!Number.isInteger(maxSamples) || maxSamples < 2) {
      throw new RangeError(`rate sample cap must be an integer >= 2, got ${maxSamples}`);
    }
  }

  /** Record an arrival at `nowMs` and evict samples outside the window/cap. */
  add(nowMs: number): void {
    this.times.push(nowMs);
    this.evict(nowMs);
  }

  private evict(nowMs: number): void {
    const cutoff = nowMs - this.windowMs;
    while (this.times.length > 0) {
      const head = this.times[0];
      if (head === undefined || head >= cutoff) break;
      this.times.shift();
    }
    while (this.times.length > this.maxSamples) {
      this.times.shift();
    }
  }

  /**
   * Hz over the in-window samples. Returns 0 until at least two samples remain,
   * or if they share a timestamp (span 0).
   */
  value(): number {
    const n = this.times.length;
    if (n < 2) return 0;
    const first = this.times[0];
    const last = this.times[n - 1];
    if (first === undefined || last === undefined) return 0;
    const spanS = (last - first) / 1000;
    if (spanS <= 0) return 0;
    return (n - 1) / spanS;
  }
}
