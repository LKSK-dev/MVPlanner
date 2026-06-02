/**
 * Map aspect-clamp tests (task: map UX; spec plan/05 §5.4/§5.5). The widget
 * sizes its canvas to {@link clampBoxToAspectRange}, so the rendered box must
 * always stay landscape between 4:3 (tallest) and 21:9 (widest) while never
 * exceeding the container it is fitted into.
 */
import { describe, expect, it } from 'vitest';
import {
  clampBoxToAspectRange,
  MAP_MAX_ASPECT,
  MAP_MIN_ASPECT,
} from '../../src/ui/widgets/map/aspect';

const aspect = (w: number, h: number): number => w / h;

describe('clampBoxToAspectRange', () => {
  it('leaves an in-range box unchanged (16:9 fits 4:3..21:9)', () => {
    expect(clampBoxToAspectRange(1600, 900)).toEqual({ width: 1600, height: 900 });
  });

  it('narrows an ultrawide box to 21:9 without exceeding it', () => {
    const box = clampBoxToAspectRange(1880, 300);
    expect(box.height).toBe(300);
    expect(box.width).toBeLessThan(1880);
    expect(aspect(box.width, box.height)).toBeCloseTo(MAP_MAX_ASPECT, 10);
  });

  it('shortens a portrait/tall box to 4:3 without exceeding it', () => {
    const box = clampBoxToAspectRange(300, 600);
    expect(box.width).toBe(300);
    expect(box.height).toBeLessThan(600);
    expect(aspect(box.width, box.height)).toBeCloseTo(MAP_MIN_ASPECT, 10);
  });

  it('keeps the exact bounds in range (no over-correction)', () => {
    const wide = clampBoxToAspectRange(MAP_MAX_ASPECT * 300, 300);
    expect(wide).toEqual({ width: MAP_MAX_ASPECT * 300, height: 300 });
    const tall = clampBoxToAspectRange(MAP_MIN_ASPECT * 300, 300);
    expect(tall).toEqual({ width: MAP_MIN_ASPECT * 300, height: 300 });
  });

  it('never enlarges the box beyond the available container', () => {
    const box = clampBoxToAspectRange(4000, 200);
    expect(box.width).toBeLessThanOrEqual(4000);
    expect(box.height).toBeLessThanOrEqual(200);
  });

  it('returns a zeroed box for non-positive or non-finite input', () => {
    expect(clampBoxToAspectRange(0, 500)).toEqual({ width: 0, height: 0 });
    expect(clampBoxToAspectRange(500, 0)).toEqual({ width: 0, height: 0 });
    expect(clampBoxToAspectRange(Number.NaN, 500)).toEqual({ width: 0, height: 0 });
    expect(clampBoxToAspectRange(500, Number.POSITIVE_INFINITY)).toEqual({
      width: 0,
      height: 0,
    });
  });

  it('honours custom bounds', () => {
    const box = clampBoxToAspectRange(1000, 100, 1, 2);
    expect(aspect(box.width, box.height)).toBeCloseTo(2, 10);
  });
});
