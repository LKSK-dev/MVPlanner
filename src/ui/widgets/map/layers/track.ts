/**
 * Live track polyline layer (task T2.4; spec plan/04 §4.2 "live track"). Draws
 * the recent vehicle positions as a polyline. The position history is owned by
 * the caller (a {@link createTrackRing} bounded buffer wired by T2.11); this
 * layer just reads it via a pure {@link DataAccessor}, decimates for cheap
 * drawing, and strokes the path. Decimation/projection are pure; the stroke is
 * canvas-deferred.
 */
import type { MapLayer } from '../../../../contracts';
import { strokePath } from './draw';
import { decimateTrack, projectPath, type LatLon } from './geometry';
import type { DataAccessor } from './types';

/** Visual options for {@link createTrackLayer}. */
export interface TrackLayerOptions {
  /** Layer id (default `'track'`). */
  id?: string;
  /** Stroke colour (default a translucent cyan). */
  color?: string;
  /** Stroke width in device pixels (default 2). */
  widthPx?: number;
  /**
   * Minimum spacing (metres) between drawn vertices; interior points closer than
   * this are dropped before projecting. Default 1 (light de-duplication).
   */
  minSpacingM?: number;
}

/** Create the live-track {@link MapLayer}. */
export function createTrackLayer(
  data: DataAccessor<readonly LatLon[]>,
  options: TrackLayerOptions = {},
): MapLayer {
  const id = options.id ?? 'track';
  const color = options.color ?? 'rgba(25, 195, 230, 0.7)';
  const widthPx = options.widthPx ?? 2;
  const minSpacingM = options.minSpacingM ?? 1;

  return {
    id,
    render(ctx): void {
      const points = data();
      if (!points || points.length < 2) return;
      const screen = projectPath(decimateTrack(points, minSpacingM), ctx.project);

      const g = ctx.canvas.getContext('2d');
      if (!g) return;
      strokePath(g, screen, { stroke: color, width: widthPx });
    },
  };
}
