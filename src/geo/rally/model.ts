/**
 * The rally-points editing model operations (task T4.7; spec plan/04 §4.3
 * rally). Pure: every helper returns a NEW {@link Rally} (or a plain value) and
 * never mutates its input, so reactive consumers (the rally editor, map editing
 * T4.4) can diff cheaply and undo/redo is trivial.
 */
import type { LatLon } from '../format';
import { DEFAULT_RALLY_ALT_M } from './convert';
import type { Rally, RallyPoint } from './types';

/** Options for {@link createRally}. */
export interface CreateRallyOptions {
  /** Default altitude (metres) for new rally points. Default {@link DEFAULT_RALLY_ALT_M}. */
  defaultAlt?: number;
}

/** Create an empty {@link Rally} with defaults applied. */
export function createRally(opts: CreateRallyOptions = {}): Rally {
  return { points: [], defaultAlt: opts.defaultAlt ?? DEFAULT_RALLY_ALT_M };
}

/** Overrides for {@link makeRallyPoint} / {@link addRallyPoint}. */
export interface RallyPointOptions {
  /** Altitude (metres). Default the model's `defaultAlt`. */
  alt?: number;
  /** Break altitude (metres). */
  breakAlt?: number;
  /** Landing direction (degrees). */
  landDir?: number;
  /** `RALLY_FLAGS` bitmask. */
  flags?: number;
}

/** Build a {@link RallyPoint} at `point`, applying the model's default altitude. */
export function makeRallyPoint(
  model: Rally,
  point: LatLon,
  opts: RallyPointOptions = {},
): RallyPoint {
  const next: RallyPoint = {
    lat: point.lat,
    lon: point.lon,
    alt: opts.alt ?? model.defaultAlt,
  };
  if (opts.breakAlt !== undefined) next.breakAlt = opts.breakAlt;
  if (opts.landDir !== undefined) next.landDir = opts.landDir;
  if (opts.flags !== undefined) next.flags = opts.flags;
  return next;
}

/** Append a rally point at `point` (the common map-click / "add" path). */
export function addRallyPoint(model: Rally, point: LatLon, opts: RallyPointOptions = {}): Rally {
  return { ...model, points: [...model.points, makeRallyPoint(model, point, opts)] };
}

/** Clamp an insertion index into `[0, length]`. */
function clampInsert(index: number, length: number): number {
  if (index < 0) return 0;
  if (index > length) return length;
  return index;
}

/** Clamp an existing-item index into `[0, length - 1]` (or `-1` when empty). */
function clampItem(index: number, length: number): number {
  if (length === 0) return -1;
  if (index < 0) return 0;
  if (index >= length) return length - 1;
  return index;
}

/** Insert `point` at index `at` (clamped into `[0, length]`). */
export function insertRallyPoint(model: Rally, at: number, point: RallyPoint): Rally {
  const index = clampInsert(at, model.points.length);
  const points = [...model.points.slice(0, index), point, ...model.points.slice(index)];
  return { ...model, points };
}

/** Delete the rally point at `index` (no-op when out of range). */
export function deleteRallyPoint(model: Rally, index: number): Rally {
  if (index < 0 || index >= model.points.length) return model;
  const points = [...model.points.slice(0, index), ...model.points.slice(index + 1)];
  return { ...model, points };
}

/**
 * Replace fields of the rally point at `index` with `patch` (no-op when out of
 * range). To clear an optional extra, pass it explicitly as `undefined`; it is
 * removed from the resulting point rather than stored as `undefined`.
 */
/** Patch type that allows explicitly setting an optional field to `undefined` (clears it). */
export type RallyPatch = { [K in keyof RallyPoint]?: RallyPoint[K] | undefined };

export function setRallyPoint(model: Rally, index: number, patch: RallyPatch): Rally {
  if (index < 0 || index >= model.points.length) return model;
  const points = model.points.map((point, i) => (i === index ? mergePoint(point, patch) : point));
  return { ...model, points };
}

/** Merge `patch` into `point`, deleting optional extras explicitly set to `undefined`. */
function mergePoint(point: RallyPoint, patch: RallyPatch): RallyPoint {
  const next: RallyPoint = { ...point };
  for (const key of ['lat', 'lon', 'alt'] as const) {
    const value = patch[key];
    if (value !== undefined) next[key] = value;
  }
  for (const key of ['breakAlt', 'landDir', 'flags'] as const) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
}

/** Move the rally point at `from` to index `to` (both clamped; no-op when equal). */
export function reorderRally(model: Rally, from: number, to: number): Rally {
  const length = model.points.length;
  const src = clampItem(from, length);
  if (src === -1) return model;
  const dst = clampItem(to, length);
  if (src === dst) return model;
  const next = [...model.points];
  const [moved] = next.splice(src, 1);
  if (!moved) return model;
  next.splice(dst, 0, moved);
  return { ...model, points: next };
}

/** Set the default altitude (metres) applied to subsequently added rally points. */
export function setDefaultAlt(model: Rally, alt: number): Rally {
  return { ...model, defaultAlt: alt };
}
