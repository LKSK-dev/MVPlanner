/**
 * Mission path layer — SCAFFOLD (task T2.4; spec plan/04 §4.3 display of mission
 * geometry). Draws the waypoint markers and the flight-path polyline joining the
 * navigational waypoints. The accessor is **optional** and yields an empty list
 * until M4 wires real `MissionClient` data (T4.x); the layer then renders the
 * uploaded/edited mission with no code change. Projection is pure; drawing is
 * canvas-deferred.
 */
import type { MapLayer } from '../../../../contracts';
import { drawDisc, drawLabel, strokePath } from './draw';
import { projectPath } from './geometry';
import type { DataAccessor, MissionOverlay } from './types';

/** Visual options for {@link createMissionLayer}. */
export interface MissionLayerOptions {
  /** Layer id (default `'mission'`). */
  id?: string;
  /** Path/line colour (default green). */
  color?: string;
  /** Waypoint marker radius in device pixels (default 5). */
  markerRadiusPx?: number;
  /** Path stroke width in device pixels (default 2). */
  widthPx?: number;
  /** Draw seq/label text beside markers (default false). */
  showLabels?: boolean;
}

/** Create the mission path {@link MapLayer} scaffold. */
export function createMissionLayer(
  data: DataAccessor<MissionOverlay>,
  options: MissionLayerOptions = {},
): MapLayer {
  const id = options.id ?? 'mission';
  const color = options.color ?? '#3ddc6b';
  const markerRadiusPx = options.markerRadiusPx ?? 5;
  const widthPx = options.widthPx ?? 2;
  const showLabels = options.showLabels ?? false;

  return {
    id,
    render(ctx): void {
      const mission = data();
      if (!mission || mission.waypoints.length === 0) return;

      // The flight path joins only navigational waypoints, in seq order.
      const navPath = mission.waypoints
        .filter((w) => w.nav !== false)
        .map((w) => ({ lat: w.lat, lon: w.lon }));
      const pathScreen = projectPath(navPath, ctx.project);
      const markers = mission.waypoints.map((w) => ({
        point: ctx.project(w.lat, w.lon),
        label: w.label ?? String(w.seq),
      }));

      const g = ctx.canvas.getContext('2d');
      if (!g) return;
      strokePath(g, pathScreen, { stroke: color, width: widthPx });
      for (const m of markers) {
        drawDisc(g, m.point, markerRadiusPx, { fill: color, stroke: '#ffffff', width: 1.5 });
        if (showLabels) drawLabel(g, m.point, m.label, { color });
      }
    },
  };
}
