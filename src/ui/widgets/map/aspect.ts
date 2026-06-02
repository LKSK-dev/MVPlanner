/**
 * Map aspect-ratio bounds + clamp (task: map UX; spec plan/05 §5.4/§5.5).
 *
 * Pure, engine-independent geometry. Every rendered map box (the canvas the
 * {@link MapWidget} sizes via its `ResizeObserver`) must stay landscape: no
 * wider than 21:9 and no taller than 4:3. The widget measures its container and
 * fits the canvas inside that box with {@link clampBoxToAspectRange} so it
 * letterboxes (never stretches) when the container itself is out of range —
 * e.g. an ultrawide Logs strip or an unusually tall pane.
 *
 * Aspect ratio is `width ÷ height`, so a larger number is *wider*.
 */

/** Tallest allowed aspect ratio (width ÷ height) — 4:3 ≈ 1.333. */
export const MAP_MIN_ASPECT = 4 / 3;

/** Widest allowed aspect ratio (width ÷ height) — 21:9 ≈ 2.333. */
export const MAP_MAX_ASPECT = 21 / 9;

/** A rendered box size in (CSS) pixels. */
export interface Box {
  /** Box width. */
  readonly width: number;
  /** Box height. */
  readonly height: number;
}

/**
 * Fit a box inside `width × height` while keeping its aspect ratio within
 * `[minAspect, maxAspect]`. The result never exceeds the input box: when the
 * input is too wide its width shrinks; when it is too tall its height shrinks;
 * otherwise the input is returned unchanged. Non-finite or non-positive inputs
 * are floored to `0`.
 *
 * @param width - Available box width (CSS px).
 * @param height - Available box height (CSS px).
 * @param minAspect - Tallest allowed `width ÷ height` (default {@link MAP_MIN_ASPECT}).
 * @param maxAspect - Widest allowed `width ÷ height` (default {@link MAP_MAX_ASPECT}).
 * @returns A box that fits inside the input with an in-range aspect ratio.
 */
export function clampBoxToAspectRange(
  width: number,
  height: number,
  minAspect: number = MAP_MIN_ASPECT,
  maxAspect: number = MAP_MAX_ASPECT,
): Box {
  const w = Number.isFinite(width) && width > 0 ? width : 0;
  const h = Number.isFinite(height) && height > 0 ? height : 0;
  if (w === 0 || h === 0) return { width: 0, height: 0 };
  const aspect = w / h;
  if (aspect > maxAspect) return { width: h * maxAspect, height: h };
  if (aspect < minAspect) return { width: w, height: w / minAspect };
  return { width: w, height: h };
}
