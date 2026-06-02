/**
 * Pane-split ratio math tests (ResizableSplit; spec plan/05 §5.3/§5.4). The
 * splitter is a thin shell over {@link nextSplitRatio}: dragging by container
 * pixels shifts the first pane's fraction of the flexible space and converts it
 * back to a clamped `fr` ratio. These assert the fraction model, the clamp, and
 * graceful degradation on degenerate input.
 */
import { describe, expect, it } from 'vitest';
import { nextSplitRatio } from '../../src/ui/widgets/split/resize';

const MIN = 0.3;
const MAX = 4;

describe('nextSplitRatio', () => {
  it('returns the current ratio unchanged for a zero delta', () => {
    expect(nextSplitRatio(1, 0, 1000, MIN, MAX)).toBeCloseTo(1, 10);
    expect(nextSplitRatio(1.3, 0, 800, MIN, MAX)).toBeCloseTo(1.3, 10);
  });

  it('grows the first pane for a positive (downward) drag', () => {
    // At ratio 1 the first pane is 50% of 1000px; +250px → 75% → ratio 3.
    expect(nextSplitRatio(1, 250, 1000, MIN, MAX)).toBeCloseTo(3, 6);
  });

  it('shrinks the first pane for a negative (upward) drag', () => {
    // At ratio 1 the first pane is 50% of 1000px; −250px → 25% → ratio 1/3.
    expect(nextSplitRatio(1, -250, 1000, MIN, MAX)).toBeCloseTo(1 / 3, 6);
  });

  it('clamps the result to the max ratio', () => {
    expect(nextSplitRatio(1, 480, 1000, MIN, MAX)).toBe(MAX);
  });

  it('clamps the result to the min ratio', () => {
    expect(nextSplitRatio(1, -480, 1000, MIN, MAX)).toBe(MIN);
  });

  it('returns the clamped current ratio when totalPx is non-positive', () => {
    expect(nextSplitRatio(1.3, 200, 0, MIN, MAX)).toBeCloseTo(1.3, 10);
    expect(nextSplitRatio(10, 0, -5, MIN, MAX)).toBe(MAX);
    expect(nextSplitRatio(0.1, 0, 0, MIN, MAX)).toBe(MIN);
  });

  it('treats a non-finite or non-positive current ratio as 1', () => {
    expect(nextSplitRatio(Number.NaN, 0, 1000, MIN, MAX)).toBeCloseTo(1, 10);
    expect(nextSplitRatio(0, 0, 1000, MIN, MAX)).toBeCloseTo(1, 10);
    expect(nextSplitRatio(-2, 0, 1000, MIN, MAX)).toBeCloseTo(1, 10);
  });

  it('treats a non-finite delta as zero', () => {
    expect(nextSplitRatio(1, Number.POSITIVE_INFINITY, 1000, MIN, MAX)).toBeCloseTo(1, 10);
  });

  it('keeps the fraction strictly inside (0,1) so the ratio stays finite', () => {
    const huge = nextSplitRatio(1, 1_000_000, 1000, MIN, Number.POSITIVE_INFINITY);
    expect(Number.isFinite(huge)).toBe(true);
    expect(huge).toBeGreaterThan(0);
  });
});
