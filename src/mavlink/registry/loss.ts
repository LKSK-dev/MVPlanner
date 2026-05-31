/**
 * Per-`(sysid, compid)` sequence-gap / packet-loss accounting (task T1.4).
 *
 * MAVLink carries a per-source 8-bit sequence counter that increments on every
 * transmitted frame and wraps 255→0. The codec deferred loss accounting to the
 * registry (spec plan/03 §3.2), so this tracker estimates missing frames from
 * the gaps while tolerating duplicates and reordered (late) frames.
 *
 * Policy for the forward distance `delta = (seq - lastSeq) mod 256`:
 * - `delta === 0`  → duplicate (same seq); counted, no loss, `lastSeq` kept.
 * - `1 ≤ delta ≤ 128` → forward step; `delta - 1` frames counted as lost,
 *   `lastSeq` advances to `seq`.
 * - `delta > 128`  → the frame is behind `lastSeq` (reordered/late); counted as
 *   out-of-order, no loss, `lastSeq` kept (so a transient reorder does not
 *   manufacture a near-full-window phantom gap).
 */
import type { LinkStats } from './types';

export class LinkLossTracker {
  private lastSeq = -1;
  private received = 0;
  private lost = 0;
  private duplicates = 0;
  private outOfOrder = 0;

  constructor(
    readonly sysid: number,
    readonly compid: number,
  ) {}

  /** Account for a frame's sequence number. */
  observe(seq: number): void {
    const s = seq & 0xff;
    this.received += 1;

    if (this.lastSeq < 0) {
      this.lastSeq = s;
      return;
    }

    const delta = (s - this.lastSeq) & 0xff;
    if (delta === 0) {
      this.duplicates += 1;
      return;
    }
    if (delta <= 128) {
      this.lost += delta - 1;
      this.lastSeq = s;
      return;
    }
    // delta in 129..255 → frame is behind lastSeq (reordered / late arrival).
    this.outOfOrder += 1;
  }

  /** Current immutable stats snapshot. */
  stats(): LinkStats {
    const denom = this.received + this.lost;
    const lossPct = denom > 0 ? (this.lost / denom) * 100 : 0;
    return {
      sysid: this.sysid,
      compid: this.compid,
      received: this.received,
      lost: this.lost,
      lossPct,
      duplicates: this.duplicates,
      outOfOrder: this.outOfOrder,
      lastSeq: this.lastSeq,
    };
  }
}
