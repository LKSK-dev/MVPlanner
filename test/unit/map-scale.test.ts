/**
 * Map scale-bar geometry tests (map UX; spec plan/04 §4.2, plan/05 §5.8).
 *
 * Pure-math coverage for {@link groundResolution} (Web-Mercator metres/pixel at
 * known lat/zoom) and {@link niceScale} (picks 1/2/5 × 10ⁿ round distances that
 * fit a pixel budget, in both metric and imperial).
 */
import { describe, expect, it } from 'vitest';
import { groundResolution, niceScale } from '../../src/ui/widgets/map/scale';
import { M_PER_FT, M_PER_MI } from '../../src/core/units';

/** A round value has the form 1/2/5 × 10ⁿ. */
function isRound(value: number): boolean {
  if (!(value > 0) || !Number.isFinite(value)) return false;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const mantissa = value / magnitude;
  return [1, 2, 5].some((m) => Math.abs(mantissa - m) < 1e-9);
}

describe('groundResolution', () => {
  it('returns the equator constant at lat 0, zoom 0', () => {
    expect(groundResolution(0, 0)).toBeCloseTo(156543.03392, 5);
  });

  it('halves per zoom level', () => {
    expect(groundResolution(0, 1)).toBeCloseTo(156543.03392 / 2, 5);
    expect(groundResolution(0, 2)).toBeCloseTo(156543.03392 / 4, 5);
  });

  it('scales by cos(lat)', () => {
    // cos(60°) = 0.5.
    expect(groundResolution(60, 0)).toBeCloseTo(156543.03392 * 0.5, 5);
  });

  it('matches the known ~38m/px at zoom 12 on the equator', () => {
    expect(groundResolution(0, 12)).toBeCloseTo(38.2185, 3);
  });
});

describe('niceScale (metric)', () => {
  it('picks a round metres distance and fits the budget', () => {
    const bar = niceScale(1, 120); // maxMeters = 120 ⇒ 100 m
    expect(bar.unit).toBe('m');
    expect(bar.value).toBe(100);
    expect(bar.meters).toBe(100);
    expect(bar.pixels).toBe(100);
    expect(bar.label).toBe('100 m');
  });

  it('switches to kilometres past 1 km', () => {
    const bar = niceScale(10, 120); // maxMeters = 1200 ⇒ 1 km
    expect(bar.unit).toBe('km');
    expect(bar.value).toBe(1);
    expect(bar.meters).toBe(1000);
    expect(bar.label).toBe('1 km');
    expect(bar.pixels).toBeLessThanOrEqual(120);
  });

  it('picks the 2 and 5 mantissas', () => {
    expect(niceScale(0.5, 120).value).toBe(50); // maxMeters 60 ⇒ 50 m
    expect(niceScale(2, 120).value).toBe(200); // maxMeters 240 ⇒ 200 m
  });

  it('never exceeds and stays a useful fraction of the pixel budget', () => {
    for (let mpp = 0.01; mpp < 100000; mpp *= 1.3) {
      const bar = niceScale(mpp, 120);
      expect(isRound(bar.value)).toBe(true);
      expect(bar.pixels).toBeGreaterThan(0);
      expect(bar.pixels).toBeLessThanOrEqual(120 + 1e-9);
      // The largest round fit is always > 1/5 of the budget (worst case 2 vs <5).
      expect(bar.pixels).toBeGreaterThan(120 * 0.39);
      // pixels and meters stay consistent with the resolution.
      expect(bar.pixels).toBeCloseTo(bar.meters / mpp, 6);
    }
  });
});

describe('niceScale (imperial)', () => {
  it('picks a round feet distance below a mile', () => {
    const bar = niceScale(1, 120, 'imperial'); // maxMeters 120 ⇒ maxFeet ≈ 393.7 ⇒ 200 ft
    expect(bar.unit).toBe('ft');
    expect(bar.value).toBe(200);
    expect(bar.meters).toBeCloseTo(200 * M_PER_FT, 9);
    expect(bar.label).toBe('200 ft');
    expect(bar.pixels).toBeLessThanOrEqual(120);
  });

  it('switches to miles when a mile or more fits', () => {
    const bar = niceScale(100, 120, 'imperial'); // maxMeters 12000 ⇒ ≈7.46 mi ⇒ 5 mi
    expect(bar.unit).toBe('mi');
    expect(bar.value).toBe(5);
    expect(bar.meters).toBeCloseTo(5 * M_PER_MI, 9);
    expect(bar.label).toBe('5 mi');
    expect(bar.pixels).toBeLessThanOrEqual(120);
  });

  it('always produces round values within the budget', () => {
    for (let mpp = 0.01; mpp < 100000; mpp *= 1.3) {
      const bar = niceScale(mpp, 120, 'imperial');
      expect(isRound(bar.value)).toBe(true);
      expect(bar.pixels).toBeGreaterThan(0);
      expect(bar.pixels).toBeLessThanOrEqual(120 + 1e-9);
    }
  });
});

describe('niceScale (degenerate inputs)', () => {
  it('returns an empty bar for non-positive or non-finite resolution', () => {
    for (const mpp of [0, -1, NaN, Infinity]) {
      const bar = niceScale(mpp, 120);
      expect(bar.pixels).toBe(0);
      expect(bar.meters).toBe(0);
      expect(bar.label).toBe('');
    }
  });

  it('returns an empty bar for a non-positive pixel budget', () => {
    expect(niceScale(10, 0).pixels).toBe(0);
  });
});
