/**
 * Immutable edit operations + defaults for the {@link Fence} model (task T4.6;
 * spec plan/04 §4.3). Pure: every helper returns a new {@link Fence} rather than
 * mutating, matching `geo/mission`'s model so the reactive editor (T4.6 UI) and
 * map editor (T4.4) stay trivially testable.
 */
import {
  FENCE_ACTION_PARAM,
  FENCE_ALT_MAX_PARAM,
  FENCE_ALT_MIN_PARAM,
  FenceBreachAction,
} from './commands';
import type { Fence, FenceInclusion, FenceShape } from './types';

/** Default minimum fence altitude (metres) for a new fence (`FENCE_ALT_MIN`). */
export const DEFAULT_MIN_ALT_M = 10;
/** Default maximum fence altitude (metres) for a new fence (`FENCE_ALT_MAX`). */
export const DEFAULT_MAX_ALT_M = 100;
/** Default breach action for a new fence (RTL or Land). */
export const DEFAULT_FENCE_ACTION: number = FenceBreachAction.RtlOrLand;
/** Default radius (metres) for a newly added circle. */
export const DEFAULT_CIRCLE_RADIUS_M = 100;

/** Options for {@link createFence}. */
export interface CreateFenceOptions {
  /** Minimum altitude (metres); defaults to {@link DEFAULT_MIN_ALT_M}. */
  minAltM?: number;
  /** Maximum altitude (metres); defaults to {@link DEFAULT_MAX_ALT_M}. */
  maxAltM?: number;
  /** Breach action; defaults to {@link DEFAULT_FENCE_ACTION}. */
  breachAction?: number;
}

/** Build an empty {@link Fence} with default altitude limits + breach action. */
export function createFence(opts: CreateFenceOptions = {}): Fence {
  return {
    shapes: [],
    minAltM: opts.minAltM ?? DEFAULT_MIN_ALT_M,
    maxAltM: opts.maxAltM ?? DEFAULT_MAX_ALT_M,
    breachAction: opts.breachAction ?? DEFAULT_FENCE_ACTION,
  };
}

/** Append a shape, returning a new {@link Fence}. */
export function addShape(fence: Fence, shape: FenceShape): Fence {
  return { ...fence, shapes: [...fence.shapes, shape] };
}

/**
 * Append an empty polygon of the given inclusion (vertices are drawn later by
 * the map editor, T4.4).
 */
export function addPolygon(fence: Fence, inclusion: FenceInclusion): Fence {
  return addShape(fence, { kind: 'polygon', inclusion, vertices: [] });
}

/** Append a circle at `center` with `radiusM` (default {@link DEFAULT_CIRCLE_RADIUS_M}). */
export function addCircle(
  fence: Fence,
  inclusion: FenceInclusion,
  center: { lat: number; lon: number } = { lat: 0, lon: 0 },
  radiusM: number = DEFAULT_CIRCLE_RADIUS_M,
): Fence {
  return addShape(fence, { kind: 'circle', inclusion, center, radiusM });
}

/** Remove the shape at `index`, returning a new {@link Fence} (no-op if out of range). */
export function removeShape(fence: Fence, index: number): Fence {
  if (index < 0 || index >= fence.shapes.length) return fence;
  return { ...fence, shapes: fence.shapes.filter((_, i) => i !== index) };
}

/** Replace the shape at `index` with `shape`, returning a new {@link Fence} (no-op if out of range). */
export function setShape(fence: Fence, index: number, shape: FenceShape): Fence {
  if (index < 0 || index >= fence.shapes.length) return fence;
  return { ...fence, shapes: fence.shapes.map((s, i) => (i === index ? shape : s)) };
}

/**
 * Set the radius (metres) of the circle at `index`. No-op if the index is out
 * of range or the shape is not a circle.
 */
export function setCircleRadius(fence: Fence, index: number, radiusM: number): Fence {
  const shape = fence.shapes[index];
  if (shape === undefined || shape.kind !== 'circle') return fence;
  return setShape(fence, index, { ...shape, radiusM });
}

/** Set a shape's inclusion/exclusion mode, returning a new {@link Fence}. */
export function setInclusion(fence: Fence, index: number, inclusion: FenceInclusion): Fence {
  const shape = fence.shapes[index];
  if (shape === undefined) return fence;
  return setShape(fence, index, { ...shape, inclusion });
}

/** Set the fence return point (or clear it when `point` is `undefined`). */
export function setReturnPoint(
  fence: Fence,
  point: { lat: number; lon: number } | undefined,
): Fence {
  if (point === undefined) {
    const { returnPoint: _drop, ...rest } = fence;
    void _drop;
    return rest;
  }
  return { ...fence, returnPoint: point };
}

/** Set the minimum fence altitude (metres). */
export function setMinAlt(fence: Fence, minAltM: number): Fence {
  return { ...fence, minAltM };
}

/** Set the maximum fence altitude (metres). */
export function setMaxAlt(fence: Fence, maxAltM: number): Fence {
  return { ...fence, maxAltM };
}

/** Set the breach action (`FENCE_ACTION`). */
export function setBreachAction(fence: Fence, breachAction: number): Fence {
  return { ...fence, breachAction };
}

/** A `FENCE_*` parameter name/value pair. */
export interface FenceParam {
  /** ArduPilot parameter name (e.g. `FENCE_ALT_MIN`). */
  readonly name: string;
  /** Parameter value. */
  readonly value: number;
}

/**
 * The non-spatial fence settings as ArduPilot `FENCE_*` parameters
 * (`FENCE_ALT_MIN`, `FENCE_ALT_MAX`, `FENCE_ACTION`). These are written via the
 * parameter service by the Plan assembly — they are *not* part of the
 * `MISSION_TYPE_FENCE` item stream produced by `./convert`.
 */
export function fenceParams(fence: Fence): readonly FenceParam[] {
  return [
    { name: FENCE_ALT_MIN_PARAM, value: fence.minAltM },
    { name: FENCE_ALT_MAX_PARAM, value: fence.maxAltM },
    { name: FENCE_ACTION_PARAM, value: fence.breachAction },
  ];
}
