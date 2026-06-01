/**
 * Shared types for the Plan map editor (task T4.4; spec plan/04 §4.3 map
 * editing). DOM-free.
 *
 * The map editor turns map clicks / drags into edits of the SHARED plan models
 * (`geo/mission` {@link MissionModel}, `geo/fence` {@link Fence}, `geo/rally`
 * {@link Rally}, and a survey {@link LatLon} polygon) per the active
 * {@link PlanToolMode}. The whole interaction is expressed as a PURE reducer
 * over an {@link EditState} (`./dispatch`), so the controller (`./controller`)
 * is a thin binding to the map engine and the logic is unit-testable with plain
 * values.
 */
import type { LatLon } from '../../../../geo/format';
import type { Fence } from '../../../../geo/fence';
import type { MissionModel } from '../../../../geo/mission';
import type { Rally } from '../../../../geo/rally';

/**
 * The active map tool. Each mode reinterprets a map click:
 *
 * - `select` — no geometry edit; clicks are relayed (selection / hit testing).
 * - `add-waypoint` — append a NAV waypoint to the mission at the click.
 * - `draw-fence-polygon` — append a vertex to the active fence polygon.
 * - `draw-fence-circle` — set the active fence circle's centre at the click.
 * - `place-rally` — add a rally point at the click.
 * - `draw-survey-polygon` — append a vertex to the survey polygon.
 * - `measure` — no geometry edit; the map-tools measure controller handles it.
 */
export type PlanToolMode =
  | 'select'
  | 'add-waypoint'
  | 'draw-fence-polygon'
  | 'draw-fence-circle'
  | 'place-rally'
  | 'draw-survey-polygon'
  | 'measure';

/** The shared plan models the map editor reads and writes as one immutable bundle. */
export interface EditState {
  /** The editable mission (waypoints). */
  readonly mission: MissionModel;
  /** The editable geofence (polygons + circles). */
  readonly fence: Fence;
  /** The editable rally-point set. */
  readonly rally: Rally;
  /** The survey polygon (WGS84 vertices) fed to the survey-grid generator. */
  readonly surveyPolygon: readonly LatLon[];
}

/** A reference to one draggable / deletable geometry feature in {@link EditState}. */
export type FeatureRef =
  | { readonly kind: 'waypoint'; readonly index: number }
  | { readonly kind: 'rally'; readonly index: number }
  | { readonly kind: 'survey-vertex'; readonly index: number }
  | { readonly kind: 'fence-vertex'; readonly shapeIndex: number; readonly vertexIndex: number }
  | { readonly kind: 'fence-center'; readonly shapeIndex: number };

/** A single map-editing intent the pure reducer applies to an {@link EditState}. */
export type MapEditEvent =
  /** A map tap at `at` (interpreted per the active {@link PlanToolMode}). */
  | { readonly kind: 'click'; readonly at: LatLon }
  /** Drag the referenced feature to `at`. */
  | { readonly kind: 'drag'; readonly ref: FeatureRef; readonly at: LatLon }
  /** Delete the referenced feature. */
  | { readonly kind: 'delete'; readonly ref: FeatureRef }
  /** Set the radius (metres) of the fence circle at `shapeIndex`. */
  | { readonly kind: 'set-fence-radius'; readonly shapeIndex: number; readonly radiusM: number };
