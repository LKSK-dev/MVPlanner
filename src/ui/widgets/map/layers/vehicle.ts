/**
 * Live vehicle marker layer (task T2.4; spec plan/04 §4.2 "vehicle icon
 * (heading + trail)"). Renders the vehicle as a heading-rotated arrow plus a
 * forward course vector. Driven by a pure {@link DataAccessor}; draws nothing
 * when the accessor yields `undefined` (no fix yet). The icon transform + vector
 * geometry are pure ({@link vehicleIconPolygon}, {@link headingVectorEnd}); only
 * the stroke/fill is canvas-deferred.
 */
import type { MapLayer } from '../../../../contracts';
import { fillPolygon, strokePath } from './draw';
import { headingVectorEnd, vehicleIconPolygon } from './geometry';
import type { DataAccessor, VehicleOverlay } from './types';

/** Visual options for {@link createVehicleLayer}. */
export interface VehicleLayerOptions {
  /** Layer id (default `'vehicle'`). */
  id?: string;
  /** Icon edge length in device pixels (default 22). */
  iconSizePx?: number;
  /** Course-vector length in device pixels (default 32). */
  vectorLengthPx?: number;
  /** Icon fill colour (default a vivid cyan). */
  color?: string;
  /** Icon outline colour (default white). */
  outline?: string;
}

/**
 * Create the vehicle marker {@link MapLayer}. The layer reads `data()` each
 * frame, projects the position via `ctx.project`, builds the icon + course
 * vector, then draws when a 2D context is available.
 */
export function createVehicleLayer(
  data: DataAccessor<VehicleOverlay>,
  options: VehicleLayerOptions = {},
): MapLayer {
  const id = options.id ?? 'vehicle';
  const iconSizePx = options.iconSizePx ?? 22;
  const vectorLengthPx = options.vectorLengthPx ?? 32;
  const color = options.color ?? '#19c3e6';
  const outline = options.outline ?? '#ffffff';

  return {
    id,
    render(ctx): void {
      const v = data();
      if (!v) return;
      const center = ctx.project(v.lat, v.lon);
      const course = v.courseDeg ?? v.headingDeg;
      const vectorEnd = headingVectorEnd(center, course, vectorLengthPx);
      const icon = vehicleIconPolygon(center, v.headingDeg, iconSizePx);

      const g = ctx.canvas.getContext('2d');
      if (!g) return;
      strokePath(g, [center, vectorEnd], { stroke: color, width: 2 });
      fillPolygon(g, icon, { fill: color, stroke: outline, width: 1.5 });
    },
  };
}
