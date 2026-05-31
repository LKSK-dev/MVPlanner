/**
 * Pure sparkline (mini-plot) geometry for the Quick-watch widget (task T2.9;
 * spec plan/04 §4.2 "live tuning/quick-graph of arbitrary numeric fields").
 *
 * Maps a series of recent samples to polyline points in an SVG viewbox. Kept
 * framework-free and side-effect-free so the path math is unit-tested
 * independently of any rendering. The widget renders the result as an inline
 * `<polyline>` (SVG — easily testable, no canvas).
 *
 * Coordinate convention: SVG y grows DOWNWARD, so the largest sample maps to the
 * smallest `y` (top of the box) and the smallest sample to the largest `y`.
 */

/** Sizing options for {@link sparklinePoints} / {@link sparklinePath}. */
export interface SparklineOptions {
  /** Viewbox width in px. */
  width: number;
  /** Viewbox height in px. */
  height: number;
  /** Vertical inset (px) kept clear at top and bottom (default 1). */
  padding?: number;
}

/** A computed point in the sparkline viewbox. */
export interface SparklinePoint {
  x: number;
  y: number;
}

/** Round to 2 decimal places (keeps emitted path strings compact). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Compute the polyline points for `samples` within a `width`×`height` viewbox.
 *
 * - Empty input → `[]`.
 * - A single sample → one centred point (`x = width / 2`).
 * - A flat series (all equal) → a horizontal line through the vertical centre.
 *
 * Samples are spread evenly across the full width (oldest at `x = 0`, newest at
 * `x = width`) and scaled to fill the height minus `padding` on each edge.
 */
export function sparklinePoints(
  samples: readonly number[],
  opts: SparklineOptions,
): SparklinePoint[] {
  const { width, height } = opts;
  const pad = opts.padding ?? 1;
  const n = samples.length;
  if (n === 0) return [];

  let min = Infinity;
  let max = -Infinity;
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min;
  const innerH = Math.max(0, height - 2 * pad);

  const points: SparklinePoint[] = [];
  for (let i = 0; i < n; i++) {
    const v = samples[i] ?? 0;
    const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
    const y = range === 0 ? height / 2 : height - pad - ((v - min) / range) * innerH;
    points.push({ x: round2(x), y: round2(y) });
  }
  return points;
}

/**
 * The {@link sparklinePoints} result as an SVG `points` string
 * (`"x0,y0 x1,y1 …"`). An empty series yields `''`.
 */
export function sparklinePath(samples: readonly number[], opts: SparklineOptions): string {
  return sparklinePoints(samples, opts)
    .map((p) => `${p.x},${p.y}`)
    .join(' ');
}
