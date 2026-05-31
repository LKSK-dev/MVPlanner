/**
 * Home marker layer (task T2.4; spec plan/04 §4.2 "home"). Renders a single
 * marker at the vehicle's home/launch position. Driven by a pure
 * {@link DataAccessor}; draws nothing when home is unknown.
 */
import type { MapLayer } from '../../../../contracts';
import { drawDisc, drawLabel } from './draw';
import type { LatLon } from './geometry';
import type { DataAccessor } from './types';

/** Visual options for {@link createHomeLayer}. */
export interface HomeLayerOptions {
  /** Layer id (default `'home'`). */
  id?: string;
  /** Marker radius in device pixels (default 7). */
  radiusPx?: number;
  /** Marker fill colour (default amber). */
  color?: string;
  /** Marker outline colour (default white). */
  outline?: string;
  /** Optional label drawn beside the marker (e.g. `t('mapoverlay.home.label')`). */
  label?: string;
}

/** Create the home marker {@link MapLayer}. */
export function createHomeLayer(
  data: DataAccessor<LatLon>,
  options: HomeLayerOptions = {},
): MapLayer {
  const id = options.id ?? 'home';
  const radiusPx = options.radiusPx ?? 7;
  const color = options.color ?? '#f5a623';
  const outline = options.outline ?? '#ffffff';
  const label = options.label;

  return {
    id,
    render(ctx): void {
      const h = data();
      if (!h) return;
      const center = ctx.project(h.lat, h.lon);

      const g = ctx.canvas.getContext('2d');
      if (!g) return;
      drawDisc(g, center, radiusPx, { fill: color, stroke: outline, width: 2 });
      if (label) drawLabel(g, center, label, { color });
    },
  };
}
