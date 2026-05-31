/**
 * Geofence layer — SCAFFOLD (task T2.4; spec plan/04 §4.3 geofence display).
 * Draws inclusion/exclusion polygons and circles. The accessor is **optional**
 * and yields empty geometry until M4 wires the fence editor / `MISSION_TYPE_FENCE`
 * (T4.6); the layer then renders with no code change. Projection + radius scaling
 * are pure ({@link radiusToPixels}); drawing is canvas-deferred.
 */
import type { MapLayer } from '../../../../contracts';
import { strokeCircle, strokePath } from './draw';
import { projectPath, radiusToPixels } from './geometry';
import type { DataAccessor, GeofenceOverlay } from './types';

/** Visual options for {@link createGeofenceLayer}. */
export interface GeofenceLayerOptions {
  /** Layer id (default `'fence'`). */
  id?: string;
  /** Inclusion (keep-in) stroke colour (default blue). */
  inclusionColor?: string;
  /** Exclusion (keep-out) stroke colour (default red). */
  exclusionColor?: string;
  /** Stroke width in device pixels (default 2). */
  widthPx?: number;
}

/** Create the geofence {@link MapLayer} scaffold. */
export function createGeofenceLayer(
  data: DataAccessor<GeofenceOverlay>,
  options: GeofenceLayerOptions = {},
): MapLayer {
  const id = options.id ?? 'fence';
  const inclusionColor = options.inclusionColor ?? '#4a90e2';
  const exclusionColor = options.exclusionColor ?? '#e2574a';
  const widthPx = options.widthPx ?? 2;

  return {
    id,
    render(ctx): void {
      const fence = data();
      if (!fence || (fence.polygons.length === 0 && fence.circles.length === 0)) return;

      const polygons = fence.polygons.map((ring) => projectPath(ring, ctx.project));
      const circles = fence.circles.map((c) => ({
        center: ctx.project(c.lat, c.lon),
        radiusPx: radiusToPixels(c, c.radiusM, ctx.project),
        color: c.inclusion ? inclusionColor : exclusionColor,
      }));

      const g = ctx.canvas.getContext('2d');
      if (!g) return;
      for (const ring of polygons) {
        strokePath(g, ring, { stroke: inclusionColor, width: widthPx, close: true });
      }
      for (const c of circles) {
        strokeCircle(g, c.center, c.radiusPx, { stroke: c.color, width: widthPx });
      }
    },
  };
}
