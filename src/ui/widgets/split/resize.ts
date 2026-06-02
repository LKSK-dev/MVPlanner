/**
 * Pane-split ratio math ({@link ResizableSplit}; spec plan/05 §5.3/§5.4).
 *
 * Pure, DOM-independent geometry for a two-pane split where the first pane is
 * laid out at `ratio` fr over the second pane at `1` fr (CSS grid/flex), so the
 * first pane occupies `ratio / (ratio + 1)` of the flexible space. Dragging the
 * splitter is expressed in container pixels and converted back to a clamped fr
 * ratio here, keeping the component a thin event shell over tested math.
 */

/** Clamp `value` into `[min, max]` (assumes `min <= max`). */
function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Compute the next split ratio (first pane's `fr`) after dragging the splitter
 * by `deltaPx` along the split axis.
 *
 * The first pane occupies `current / (current + 1)` of `totalPx`; a positive
 * `deltaPx` (e.g. dragging down/right, growing the first pane) shifts that
 * fraction by `deltaPx / totalPx`. The fraction is kept strictly inside
 * `(0, 1)` before converting back to an fr ratio, and the result is clamped to
 * `[min, max]`. Non-finite or non-positive inputs degrade gracefully: a
 * non-positive `totalPx` returns the clamped `current`, and a non-finite
 * `current` is treated as `1`.
 *
 * @param current - Current first-pane ratio (`fr`), expected `> 0`.
 * @param deltaPx - Pointer delta along the split axis (CSS px; positive grows pane 1).
 * @param totalPx - Total flexible extent of both panes along the split axis (CSS px).
 * @param min - Minimum allowed ratio.
 * @param max - Maximum allowed ratio (`>= min`).
 * @returns The clamped next ratio.
 */
export function nextSplitRatio(
  current: number,
  deltaPx: number,
  totalPx: number,
  min: number,
  max: number,
): number {
  const c = Number.isFinite(current) && current > 0 ? current : 1;
  const total = Number.isFinite(totalPx) && totalPx > 0 ? totalPx : 0;
  if (total === 0) return clamp(c, min, max);
  const delta = Number.isFinite(deltaPx) ? deltaPx : 0;
  const fraction = c / (c + 1) + delta / total;
  const bounded = clamp(fraction, 0.001, 0.999);
  const ratio = bounded / (1 - bounded);
  return clamp(ratio, min, max);
}
