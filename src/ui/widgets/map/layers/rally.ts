/**
 * Rally points layer — SCAFFOLD (task T2.4; spec plan/04 §4.3 rally display).
 * Draws each rally point as a marker. The accessor is **optional** and yields no
 * points until M4 wires the rally editor / `MISSION_TYPE_RALLY` (T4.7); the layer
 * then renders with no code change. Projection is pure; drawing is canvas-deferred.
 */
import type { MapLayer } from '../../../../contracts';
import { drawDisc, drawLabel } from './draw';
import type { DataAccessor, RallyOverlay } from './types';

/** Visual options for {@link createRallyLayer}. */
export interface RallyLayerOptions {
  /** Layer id (default `'rally'`). */
  id?: string;
  /** Marker radius in device pixels (default 6). */
  radiusPx?: number;
  /** Marker fill colour (default purple). */
  color?: string;
  /** Marker outline colour (default white). */
  outline?: string;
  /** Draw point labels (default false). */
  showLabels?: boolean;
}

/** Create the rally-points {@link MapLayer} scaffold. */
export function createRallyLayer(
  data: DataAccessor<RallyOverlay>,
  options: RallyLayerOptions = {},
): MapLayer {
  const id = options.id ?? 'rally';
  const radiusPx = options.radiusPx ?? 6;
  const color = options.color ?? '#9b59b6';
  const outline = options.outline ?? '#ffffff';
  const showLabels = options.showLabels ?? false;

  return {
    id,
    render(ctx): void {
      const rally = data();
      if (!rally || rally.points.length === 0) return;
      const markers = rally.points.map((p) => ({
        point: ctx.project(p.lat, p.lon),
        label: p.label,
      }));

      const g = ctx.canvas.getContext('2d');
      if (!g) return;
      for (const m of markers) {
        drawDisc(g, m.point, radiusPx, { fill: color, stroke: outline, width: 2 });
        if (showLabels && m.label) drawLabel(g, m.point, m.label, { color });
      }
    },
  };
}
