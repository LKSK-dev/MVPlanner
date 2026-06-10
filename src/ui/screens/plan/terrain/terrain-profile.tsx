/**
 * Terrain profile chart (task T4.8; spec plan/04 §4.3 "show terrain profile
 * chart, warn on collisions", plan/05 §5.3 Plan).
 *
 * Plots ground elevation (AMSL) versus distance along the mission path, overlays
 * the planned path altitude, and marks low-clearance / collision points (where
 * the planned altitude drops within `minClearanceM` of, or below, the terrain).
 * The profile data is **injected** ({@link TerrainProfileProps.points}) — the
 * async elevation sampling lives in `geo/terrain` — so the component renders
 * purely from data and unit-tests without a provider, map or network.
 */
import { For, Show, createMemo, type Component } from 'solid-js';
import { t as defaultT, type TFn } from '../../../../core/i18n';
import { collisionCheck, type CollisionMarker, type TerrainProfilePoint } from '../../../../geo/terrain';
import './messages';
import './terrain.css';

export type { TFn };

/** {@link TerrainProfile} props. */
export interface TerrainProfileProps {
  /** Profile points (distance + terrain AMSL + optional planned AMSL), injected. */
  points: readonly TerrainProfilePoint[];
  /** Minimum acceptable clearance (m) below which a point is flagged. Default 10. */
  minClearanceM?: number;
  /** Chart width in CSS pixels (default 600). */
  width?: number;
  /** Chart height in CSS pixels (default 200). */
  height?: number;
  /** i18n translate function (default the app `t`). */
  t?: TFn;
}

/** Inner-plot padding (px): left/right/top/bottom around the axes. */
export const PAD = { left: 8, right: 8, top: 8, bottom: 8 } as const;

/** Clamp `value` into the inclusive `[lo, hi]` range; non-finite snaps to `lo`. */
function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, value));
}

interface Scales {
  readonly x: (distanceM: number) => number;
  readonly y: (elevM: number) => number;
  readonly baseY: number;
}

/** Round to `digits` decimals for display. */
function round(value: number, digits = 0): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** The terrain profile chart component. */
export const TerrainProfile: Component<TerrainProfileProps> = (props) => {
  const t = props.t ?? defaultT;
  const width = (): number => props.width ?? 600;
  const height = (): number => props.height ?? 200;
  const minClearance = (): number => props.minClearanceM ?? 10;

  /** Linear scales from data space to the SVG viewport. */
  const scales = createMemo<Scales>(() => {
    const pts = props.points;
    const w = width();
    const h = height();
    let maxDist = 0;
    let minE = Number.POSITIVE_INFINITY;
    let maxE = Number.NEGATIVE_INFINITY;
    for (const p of pts) {
      if (p.distanceM > maxDist) maxDist = p.distanceM;
      if (p.terrainM < minE) minE = p.terrainM;
      if (p.terrainM > maxE) maxE = p.terrainM;
      if (p.plannedAmslM !== undefined) {
        if (p.plannedAmslM < minE) minE = p.plannedAmslM;
        if (p.plannedAmslM > maxE) maxE = p.plannedAmslM;
      }
    }
    if (!Number.isFinite(minE) || !Number.isFinite(maxE)) {
      minE = 0;
      maxE = 1;
    }
    if (maxE <= minE) maxE = minE + 1;
    const x0 = PAD.left;
    const x1 = w - PAD.right;
    const y0 = PAD.top;
    const y1 = h - PAD.bottom;
    const spanX = maxDist > 0 ? maxDist : 1;
    const spanE = maxE - minE;
    // Clamp both axes to the plot box so no point (terrain, planned or marker)
    // can ever render outside [x0,x1] × [y0,y1] — e.g. a planned altitude far
    // below the terrain, or a degenerate / non-finite value.
    return {
      x: (d: number): number => clamp(x0 + ((x1 - x0) * d) / spanX, x0, x1),
      y: (e: number): number => clamp(y1 - ((y1 - y0) * (e - minE)) / spanE, y0, y1),
      baseY: y1,
    };
  });

  /** Filled terrain polygon: top follows terrain, closed down to the base. */
  const terrainPath = createMemo<string>(() => {
    const pts = props.points;
    const s = scales();
    if (pts.length === 0) return '';
    const top = pts.map((p) => `${round(s.x(p.distanceM), 2)},${round(s.y(p.terrainM), 2)}`);
    const firstX = round(s.x(pts[0]?.distanceM ?? 0), 2);
    const lastX = round(s.x(pts[pts.length - 1]?.distanceM ?? 0), 2);
    const base = round(s.baseY, 2);
    return `M ${firstX},${base} L ${top.join(' L ')} L ${lastX},${base} Z`;
  });

  /** Planned-altitude polyline over the contiguous points that carry one. */
  const plannedPath = createMemo<string>(() => {
    const s = scales();
    const segments: string[] = [];
    let cur: string[] = [];
    for (const p of props.points) {
      if (p.plannedAmslM === undefined) {
        if (cur.length > 0) segments.push(cur.join(' '));
        cur = [];
        continue;
      }
      cur.push(`${round(s.x(p.distanceM), 2)},${round(s.y(p.plannedAmslM), 2)}`);
    }
    if (cur.length > 0) segments.push(cur.join(' '));
    return segments.map((seg) => `M ${seg.replaceAll(' ', ' L ')}`).join(' ');
  });

  /** Collision / low-clearance markers from the pure `geo/terrain` check. */
  const markers = createMemo<CollisionMarker[]>(() =>
    collisionCheck(props.points, minClearance()),
  );

  return (
    <section class="mvp-terrain" role="region" aria-label={t('terrain.region.label')}>
      <header class="mvp-terrain__header">
        <h2 class="mvp-terrain__heading">{t('terrain.title')}</h2>
        <Show
          when={markers().length > 0}
          fallback={
            <span class="mvp-terrain__ok" data-testid="terrain-status">
              {t('terrain.collision.none')}
            </span>
          }
        >
          <span class="mvp-terrain__warn" role="alert" data-testid="terrain-status">
            {t('terrain.collision.warning', { n: markers().length })}
          </span>
        </Show>
      </header>

      <Show
        when={props.points.length > 0}
        fallback={
          <p class="mvp-terrain__empty" data-testid="terrain-empty">
            {t('terrain.empty')}
          </p>
        }
      >
        <svg
          class="mvp-terrain__chart"
          data-testid="terrain-chart"
          width={width()}
          height={height()}
          viewBox={`0 0 ${width()} ${height()}`}
          role="img"
          aria-label={t('terrain.chart.label')}
        >
          <path class="mvp-terrain__ground" data-testid="terrain-ground" d={terrainPath()} />
          <Show when={plannedPath() !== ''}>
            <path class="mvp-terrain__planned" data-testid="terrain-planned" d={plannedPath()} />
          </Show>
          <For each={markers()}>
            {(m) => (
              <circle
                class="mvp-terrain__marker"
                data-testid="terrain-marker"
                cx={round(scales().x(m.distanceM), 2)}
                cy={round(scales().y(m.plannedAmslM), 2)}
                r={4}
              >
                <title>
                  {t('terrain.clearance.label', { n: round(m.clearanceM, 1) })}
                </title>
              </circle>
            )}
          </For>
        </svg>
      </Show>

      <footer class="mvp-terrain__legend" aria-hidden="true">
        <span class="mvp-terrain__legend-item mvp-terrain__legend-item--ground">
          {t('terrain.legend.terrain')}
        </span>
        <span class="mvp-terrain__legend-item mvp-terrain__legend-item--planned">
          {t('terrain.legend.planned')}
        </span>
      </footer>
    </section>
  );
};
