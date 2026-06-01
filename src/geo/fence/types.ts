/**
 * Shared types for the geofence editing model (task T4.6; spec plan/04 §4.3
 * Geofence). Pure, DOM-free.
 *
 * A {@link Fence} is the editing-oriented view of an ArduPilot geofence: a list
 * of inclusion/exclusion **polygons** (vertex lists) and **circles**
 * (centre + radius), an optional **return point**, plus the non-spatial
 * min/max altitude and breach action that ArduPilot stores as *parameters*
 * (`FENCE_ALT_MIN`/`FENCE_ALT_MAX`/`FENCE_ACTION`), not as mission items.
 *
 * Geographic positions are plain WGS84 **degrees** ({@link import('../format').LatLon});
 * the model never juggles the `1e7` mission scale factor — that lives in
 * `./convert`. All shapes carry an `inclusion` discriminator so a single shape
 * list drives the editor (`./model` provides immutable edit ops).
 */
import type { LatLon } from '../format';

/** Whether a fence shape keeps the vehicle *inside* (inclusion) or *outside* (exclusion). */
export type FenceInclusion = 'inclusion' | 'exclusion';

/**
 * An inclusion/exclusion polygon: an ordered list of WGS84 vertices. The map
 * editor (T4.4) owns vertex drawing, so a freshly added polygon may have an
 * empty {@link vertices} list until the user draws it.
 */
export interface FencePolygon {
  readonly kind: 'polygon';
  readonly inclusion: FenceInclusion;
  /** Ordered WGS84 vertices (degrees); the ring is implicitly closed. */
  readonly vertices: readonly LatLon[];
}

/** An inclusion/exclusion circle: a WGS84 centre and a radius in metres. */
export interface FenceCircle {
  readonly kind: 'circle';
  readonly inclusion: FenceInclusion;
  /** Circle centre (WGS84 degrees). */
  readonly center: LatLon;
  /** Circle radius in metres (`> 0`). */
  readonly radiusM: number;
}

/** A geofence shape: an inclusion/exclusion {@link FencePolygon} or {@link FenceCircle}. */
export type FenceShape = FencePolygon | FenceCircle;

/** A shape's discriminator (`'polygon'` | `'circle'`). */
export type FenceShapeKind = FenceShape['kind'];

/**
 * The editable geofence: an ordered {@link FenceShape} list, an optional return
 * point, and the non-spatial altitude limits + breach action.
 *
 * The altitude limits and breach action are *not* part of the
 * `MISSION_TYPE_FENCE` item stream (see `./convert`); they map to ArduPilot
 * `FENCE_*` parameters via `./model`'s {@link import('./model').fenceParams}.
 */
export interface Fence {
  /** Ordered inclusion/exclusion polygons and circles. */
  readonly shapes: readonly FenceShape[];
  /** Optional fence return point (`NAV_FENCE_RETURN_POINT`). */
  readonly returnPoint?: LatLon;
  /** Minimum altitude (metres, `FENCE_ALT_MIN`). */
  readonly minAltM: number;
  /** Maximum altitude (metres, `FENCE_ALT_MAX`). */
  readonly maxAltM: number;
  /** Breach action (`FENCE_ACTION`); see {@link import('./commands').FenceBreachAction}. */
  readonly breachAction: number;
}
