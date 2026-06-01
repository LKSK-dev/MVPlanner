/**
 * Map-edit controller (task T4.4; spec plan/04 §4.3 map editing). Binds the pure
 * editing reducer (`./dispatch`) to a live map engine: it routes engine clicks
 * through {@link dispatchMapEdit} under the active {@link PlanToolMode}, renders
 * the editable geometry through the existing overlay layers (mission / fence /
 * rally) plus a small survey-polygon layer, and — when attached to the map DOM
 * surface — implements drag-to-move + Alt/Ctrl-click-to-delete of individual
 * features via a capture-phase pointer handler (so it takes precedence over the
 * map widget's pan).
 *
 * State lives in the Plan screen's shared signals; the controller reads them via
 * {@link MapEditControllerDeps.getState} and writes edits back via
 * {@link MapEditControllerDeps.setState}. The interaction logic is pure and
 * tested in `./dispatch`; the canvas draw + pointer wiring here are
 * canvas-deferred (tolerated when no 2D context / pointer geometry is present).
 */
import type { MapLayer } from '../../../../contracts';
import {
  createGeofenceLayer,
  createMissionLayer,
  createRallyLayer,
  type LatLon,
} from '../../../widgets/map/layers';
import type { LatLon as EngineLatLon } from '../../../widgets/map/engine';
import {
  dispatchMapEdit,
  hitTest,
  toFenceOverlay,
  toMissionOverlay,
  toRallyOverlay,
} from './dispatch';
import type { EditState, FeatureRef, PlanToolMode } from './types';

/** Device-pixel hit radius for grabbing / deleting a feature. */
const HIT_RADIUS_PX = 16;

/** The slice of the map engine the controller needs (the raster engine satisfies it). */
export interface MapEditHost {
  on(ev: 'click', cb: (e: EngineLatLon) => void): () => void;
  addLayer(layer: MapLayer): () => void;
  requestRedraw(): void;
  project(lat: number, lon: number): [number, number];
  unproject(px: number, py: number): EngineLatLon;
}

/** Construction dependencies for {@link createMapEditController}. */
export interface MapEditControllerDeps {
  /** The map engine to bind clicks / layers / projection to. */
  readonly host: MapEditHost;
  /** Read the current shared model bundle. */
  readonly getState: () => EditState;
  /** Persist an edited model bundle back to the shared signals. */
  readonly setState: (next: EditState) => void;
  /** Read the active plan tool mode. */
  readonly getMode: () => PlanToolMode;
  /** Survey-polygon stroke colour (default amber). */
  readonly surveyColor?: string;
}

/** The map-edit controller surface. */
export interface MapEditController {
  /** Bind drag / delete pointer handling to the map DOM surface (the map container). */
  attach(surface: HTMLElement): void;
  /** The feature currently being dragged, or `undefined`. */
  draggingRef(): FeatureRef | undefined;
  /** Remove the click subscription, overlay layers and pointer handlers. */
  dispose(): void;
}

/** Create the map-edit {@link MapEditController}, registering overlays immediately. */
export function createMapEditController(deps: MapEditControllerDeps): MapEditController {
  const { host, getState, setState, getMode } = deps;
  const surveyColor = deps.surveyColor ?? '#f5a623';

  // Overlay layers fed by the shared models (the existing T2.4 scaffolds).
  const offMission = host.addLayer(
    createMissionLayer(() => toMissionOverlay(getState().mission), { showLabels: true }),
  );
  const offFence = host.addLayer(createGeofenceLayer(() => toFenceOverlay(getState().fence)));
  const offRally = host.addLayer(createRallyLayer(() => toRallyOverlay(getState().rally), { showLabels: true }));
  const offSurvey = host.addLayer(createSurveyLayer(() => getState().surveyPolygon, surveyColor));

  // Engine click → pure reducer (no-op in select / measure modes).
  const offClick = host.on('click', (e) => {
    const mode = getMode();
    if (mode === 'select' || mode === 'measure') return;
    const next = dispatchMapEdit(getState(), mode, { kind: 'click', at: { lat: e.lat, lon: e.lon } });
    setState(next);
    host.requestRedraw();
  });

  // --- drag / delete via capture-phase pointer handling --------------------
  let surface: HTMLElement | undefined;
  let canvas: HTMLCanvasElement | undefined;
  let dragging: FeatureRef | undefined;
  let detachPointer: (() => void) | undefined;

  /** CSS-pixel pointer position → device-pixel canvas coordinate (engine space). */
  function devicePoint(clientX: number, clientY: number): { x: number; y: number } | undefined {
    if (canvas === undefined) return undefined;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return undefined;
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }

  function onPointerDown(e: PointerEvent): void {
    const mode = getMode();
    // Only the select tool grabs existing features; the draw tools place new
    // geometry on click and must not be hijacked by a drag.
    if (mode !== 'select') return;
    const p = devicePoint(e.clientX, e.clientY);
    if (p === undefined) return;
    const ref = hitTest(getState(), (lat, lon) => host.project(lat, lon), p.x, p.y, HIT_RADIUS_PX);
    if (ref === undefined) return;
    // Alt/Ctrl-click deletes the feature outright; a plain press starts a drag.
    if (e.altKey || e.ctrlKey || e.metaKey) {
      setState(dispatchMapEdit(getState(), mode, { kind: 'delete', ref }));
      host.requestRedraw();
      e.stopPropagation();
      e.preventDefault();
      return;
    }
    dragging = ref;
    canvas?.setPointerCapture?.(e.pointerId);
    e.stopPropagation();
    e.preventDefault();
  }

  function onPointerMove(e: PointerEvent): void {
    if (dragging === undefined) return;
    const p = devicePoint(e.clientX, e.clientY);
    if (p === undefined) return;
    const at = host.unproject(p.x, p.y);
    setState(dispatchMapEdit(getState(), getMode(), { kind: 'drag', ref: dragging, at: { lat: at.lat, lon: at.lon } }));
    host.requestRedraw();
    e.stopPropagation();
  }

  function onPointerUp(e: PointerEvent): void {
    if (dragging === undefined) return;
    dragging = undefined;
    canvas?.releasePointerCapture?.(e.pointerId);
    e.stopPropagation();
  }

  function attach(next: HTMLElement): void {
    detachPointer?.();
    surface = next;
    canvas = next.querySelector('canvas') ?? undefined;
    surface.addEventListener('pointerdown', onPointerDown, true);
    surface.addEventListener('pointermove', onPointerMove, true);
    surface.addEventListener('pointerup', onPointerUp, true);
    surface.addEventListener('pointercancel', onPointerUp, true);
    detachPointer = (): void => {
      surface?.removeEventListener('pointerdown', onPointerDown, true);
      surface?.removeEventListener('pointermove', onPointerMove, true);
      surface?.removeEventListener('pointerup', onPointerUp, true);
      surface?.removeEventListener('pointercancel', onPointerUp, true);
    };
  }

  return {
    attach,
    draggingRef: () => dragging,
    dispose(): void {
      offClick();
      offMission();
      offFence();
      offRally();
      offSurvey();
      detachPointer?.();
    },
  };
}

/** A small {@link MapLayer} that strokes the in-progress survey polygon + vertices. */
function createSurveyLayer(getPolygon: () => readonly LatLon[], color: string): MapLayer {
  return {
    id: 'plan-survey',
    render(ctx): void {
      const polygon = getPolygon();
      if (polygon.length === 0) return;
      const g = ctx.canvas.getContext('2d');
      if (!g) return;
      const pts = polygon.map((v) => ctx.project(v.lat, v.lon));
      if (pts.length >= 2) {
        g.save();
        g.beginPath();
        const first = pts[0];
        if (first === undefined) {
          g.restore();
          return;
        }
        g.moveTo(first[0], first[1]);
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i];
          if (p !== undefined) g.lineTo(p[0], p[1]);
        }
        g.closePath();
        g.strokeStyle = color;
        g.lineWidth = 2;
        g.setLineDash([6, 4]);
        g.stroke();
        g.fillStyle = 'rgba(245, 166, 35, 0.12)';
        g.fill();
        g.restore();
      }
      g.save();
      g.fillStyle = color;
      for (const p of pts) {
        if (p === undefined) continue;
        g.beginPath();
        g.arc(p[0], p[1], 4, 0, Math.PI * 2);
        g.fill();
      }
      g.restore();
    },
  };
}
