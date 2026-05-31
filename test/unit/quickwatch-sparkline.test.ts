/**
 * Quick-watch pure-logic tests (task T2.9): the bounded sample ring, the
 * sparkline polyline geometry, the `message.field` path helpers and the value
 * formatter. These carry no DOM and run framework-free.
 */
import { describe, it, expect } from 'vitest';
import { RingBuffer } from '../../src/ui/widgets/quickwatch/ring';
import { sparklinePath, sparklinePoints } from '../../src/ui/widgets/quickwatch/sparkline';
import { formatWatchValue } from '../../src/ui/widgets/quickwatch/format';
import { parsePath, pathOf, samePath } from '../../src/ui/widgets/quickwatch/path';

describe('RingBuffer', () => {
  it('rejects a non-positive / non-integer capacity', () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    expect(() => new RingBuffer(-3)).toThrow(RangeError);
    expect(() => new RingBuffer(2.5)).toThrow(RangeError);
  });

  it('retains samples up to capacity, oldest → newest', () => {
    const ring = new RingBuffer(3);
    expect(ring.size).toBe(0);
    expect(ring.last).toBeUndefined();
    ring.push(1);
    ring.push(2);
    expect(ring.toArray()).toEqual([1, 2]);
    expect(ring.last).toBe(2);
  });

  it('evicts the oldest samples once full (bounded memory)', () => {
    const ring = new RingBuffer(3);
    for (const v of [1, 2, 3, 4, 5]) ring.push(v);
    expect(ring.size).toBe(3);
    expect(ring.toArray()).toEqual([3, 4, 5]);
    expect(ring.last).toBe(5);
  });

  it('clears', () => {
    const ring = new RingBuffer(3);
    ring.push(1);
    ring.clear();
    expect(ring.size).toBe(0);
    expect(ring.toArray()).toEqual([]);
  });

  it('returns a copy from toArray (no aliasing)', () => {
    const ring = new RingBuffer(3);
    ring.push(1);
    const a = ring.toArray() as number[];
    a.push(99);
    expect(ring.toArray()).toEqual([1]);
  });
});

describe('sparklinePoints / sparklinePath', () => {
  const opts = { width: 100, height: 20, padding: 0 };

  it('returns an empty path for no samples', () => {
    expect(sparklinePoints([], opts)).toEqual([]);
    expect(sparklinePath([], opts)).toBe('');
  });

  it('centres a single sample', () => {
    const pts = sparklinePoints([5], opts);
    expect(pts).toEqual([{ x: 50, y: 10 }]);
  });

  it('draws a flat (mid-height) line for an all-equal series', () => {
    const pts = sparklinePoints([7, 7, 7], opts);
    expect(pts.map((p) => p.y)).toEqual([10, 10, 10]);
    expect(pts.map((p) => p.x)).toEqual([0, 50, 100]);
  });

  it('spreads x evenly across the full width', () => {
    const pts = sparklinePoints([0, 1, 2, 3, 4], { width: 100, height: 10, padding: 0 });
    expect(pts.map((p) => p.x)).toEqual([0, 25, 50, 75, 100]);
  });

  it('maps the max to the top and the min to the bottom (SVG y down)', () => {
    const pts = sparklinePoints([0, 10], { width: 10, height: 10, padding: 0 });
    // min=0 → y=height (bottom); max=10 → y=0 (top).
    expect(pts[0]).toEqual({ x: 0, y: 10 });
    expect(pts[1]).toEqual({ x: 10, y: 0 });
  });

  it('honours vertical padding', () => {
    const pts = sparklinePoints([0, 10], { width: 10, height: 10, padding: 2 });
    // innerH = 10 - 2*2 = 6; min → height-pad = 8; max → height-pad-6 = 2.
    expect(pts[0]?.y).toBe(8);
    expect(pts[1]?.y).toBe(2);
  });

  it('reflects the actual samples in the path string', () => {
    const path = sparklinePath([1, 2, 3], { width: 4, height: 4, padding: 0 });
    expect(path).toBe('0,4 2,2 4,0');
  });
});

describe('formatWatchValue', () => {
  it('renders integers exactly', () => {
    expect(formatWatchValue(0)).toBe('0');
    expect(formatWatchValue(12000)).toBe('12000');
    expect(formatWatchValue(-7)).toBe('-7');
  });

  it('trims float noise to 3 dp', () => {
    expect(formatWatchValue(1.23456)).toBe('1.235');
    expect(formatWatchValue(1.2)).toBe('1.2');
    expect(formatWatchValue(1.2000001)).toBe('1.2');
  });

  it('renders non-finite values as an em dash', () => {
    expect(formatWatchValue(Number.NaN)).toBe('\u2014');
    expect(formatWatchValue(Number.POSITIVE_INFINITY)).toBe('\u2014');
  });
});

describe('path helpers', () => {
  it('builds and parses message.field paths losslessly', () => {
    const f = { msg: 'VFR_HUD', field: 'airspeed' };
    expect(pathOf(f)).toBe('VFR_HUD.airspeed');
    expect(parsePath('VFR_HUD.airspeed')).toEqual(f);
  });

  it('rejects malformed paths', () => {
    expect(parsePath('noseparator')).toBeUndefined();
    expect(parsePath('.leading')).toBeUndefined();
    expect(parsePath('trailing.')).toBeUndefined();
  });

  it('compares paths by message + field', () => {
    expect(samePath({ msg: 'A', field: 'b' }, { msg: 'A', field: 'b' })).toBe(true);
    expect(samePath({ msg: 'A', field: 'b' }, { msg: 'A', field: 'c' })).toBe(false);
  });
});
