/**
 * Map widget (task T2.3; spec plan/04 §4.2 map, plan/05 §5.4/§5.5/§5.8).
 *
 * A thin Solid wrapper that mounts a `<canvas>`, binds it to an injected
 * {@link RasterMapEngine} and wires interaction: drag-to-pan, wheel + pinch +
 * button zoom, keyboard pan/zoom, and click → `{lat,lon}` (via the engine's
 * event API). The engine owns all rendering and camera math; this component owns
 * only the DOM, sizing (HiDPI via `ResizeObserver`) and accessibility.
 *
 * The widget is store-agnostic: the Flight/Plan screens (T2.11/T4.x) build the
 * engine with a storage-backed tile cache and add overlay layers (T2.4); this
 * component never reaches into the store or context.
 *
 * Accessibility (spec §5.8): the container is a keyboard-focusable
 * `role="application"` with an `aria-label`, and a polite live region announces
 * the center/zoom readout on every camera change.
 *
 * Pointer math note: DOM events report CSS pixels; the engine works in device
 * pixels. The component scales by `canvas.width / rect.width` before calling the
 * engine so projection matches what is drawn.
 */
import { Show, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { t as defaultT } from '../../../core/i18n';
import type { UnitSystem } from '../../../contracts';
import './messages';
import type { LatLon, MapView, RasterMapEngine } from './engine';
import { groundResolution, niceScale, type ScaleBar } from './scale';

/** The i18n translate function (matches `core/i18n` `t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** {@link MapWidget} props. */
export interface MapWidgetProps {
  /**
   * The raster map engine to drive. Built by the screen (T2.11) with a
   * storage-backed tile cache; overlay layers are added on it directly (T2.4).
   */
  engine: RasterMapEngine;
  /** i18n translate function (default the app `t`). */
  t?: TFn;
  /** Per-axis keyboard pan step in CSS pixels (default 64). */
  panStep?: number;
  /** Keyboard zoom step (default 0.5). */
  zoomStep?: number;
  /**
   * Unit system for the scale-bar label (default `'metric'`). Screens may pass
   * the app's configured {@link UnitSystem} to show feet/miles instead.
   */
  units?: UnitSystem;
}

/** Maximum scale-bar length in CSS pixels; the bar picks a round fit below this. */
const SCALE_MAX_PX = 120;

/** Distance (CSS px) a pointer may move before a press counts as a drag, not a click. */
const CLICK_SLOP = 4;

/** Format a coordinate component for the readout. */
function fmtDeg(n: number): string {
  return n.toFixed(5);
}

/** The interactive raster map. */
export const MapWidget: Component<MapWidgetProps> = (props) => {
  const tFn = (): TFn => props.t ?? defaultT;
  const panStep = (): number => props.panStep ?? 64;
  const zoomStep = (): number => props.zoomStep ?? 0.5;

  const [viewState, setViewState] = createSignal<MapView>(props.engine.getView());
  const [dpr, setDpr] = createSignal(1);

  /** The live scale bar for the current camera (metres-per-CSS-pixel = res × dpr). */
  const scaleBar = createMemo<ScaleBar>(() => {
    const v = viewState();
    const metersPerCssPx = groundResolution(v.lat, v.zoom) * dpr();
    return niceScale(metersPerCssPx, SCALE_MAX_PX, props.units ?? 'metric');
  });

  let container!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;

  onMount(() => {
    const engine = props.engine;
    const view = container.ownerDocument.defaultView;
    const dpr = view?.devicePixelRatio && view.devicePixelRatio > 0 ? view.devicePixelRatio : 1;
    setDpr(dpr);

    const resize = (): void => {
      const rect = container.getBoundingClientRect();
      // Fill the entire container: the canvas spans its pane at the pane's
      // natural aspect (no letterboxing). CSS sizes it to 100% × 100%; here we
      // only match the backing-store resolution (CSS px × dpr) for crisp HiDPI.
      const cssW = Math.max(1, Math.floor(rect.width));
      const cssH = Math.max(1, Math.floor(rect.height));
      const dw = Math.max(1, Math.round(cssW * dpr));
      const dh = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== dw || canvas.height !== dh) {
        canvas.width = dw;
        canvas.height = dh;
        engine.requestRedraw();
      }
    };

    let observer: ResizeObserver | undefined;
    if (view && typeof view.ResizeObserver === 'function') {
      observer = new view.ResizeObserver(() => resize());
      observer.observe(container);
    }
    resize();
    engine.attach(canvas);

    const offMove = engine.on('move', () => setViewState(engine.getView()));
    setViewState(engine.getView());

    // CSS px → device px scale for the current canvas.
    const scaleX = (): number => {
      const rect = canvas.getBoundingClientRect();
      return rect.width > 0 ? canvas.width / rect.width : dpr;
    };
    const scaleY = (): number => {
      const rect = canvas.getBoundingClientRect();
      return rect.height > 0 ? canvas.height / rect.height : dpr;
    };
    const localPoint = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
      const rect = canvas.getBoundingClientRect();
      return { x: (e.clientX - rect.left) * scaleX(), y: (e.clientY - rect.top) * scaleY() };
    };

    // --- Pointer drag / pinch state ---
    const pointers = new Map<number, { x: number; y: number }>();
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let pressX = 0;
    let pressY = 0;
    let pinchDist = 0;
    let moved = false;

    const onPointerDown = (e: PointerEvent): void => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture?.(e.pointerId);
      if (pointers.size === 1) {
        dragging = true;
        moved = false;
        lastX = e.clientX;
        lastY = e.clientY;
        pressX = e.clientX;
        pressY = e.clientY;
      } else if (pointers.size === 2) {
        dragging = false;
        const pts = [...pointers.values()];
        pinchDist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
      }
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const pts = [...pointers.values()];
        const dist = Math.hypot(pts[0]!.x - pts[1]!.x, pts[0]!.y - pts[1]!.y);
        if (pinchDist > 0 && dist > 0) {
          const dz = Math.log2(dist / pinchDist);
          const midClientX = (pts[0]!.x + pts[1]!.x) / 2;
          const midClientY = (pts[0]!.y + pts[1]!.y) / 2;
          engine.zoomBy(dz, localPoint({ clientX: midClientX, clientY: midClientY }));
        }
        pinchDist = dist;
        return;
      }
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      if (Math.abs(e.clientX - pressX) > CLICK_SLOP || Math.abs(e.clientY - pressY) > CLICK_SLOP) {
        moved = true;
      }
      // Drag content with the pointer ⇒ center moves opposite, in device px.
      engine.panByPixels(-dx * scaleX(), -dy * scaleY());
    };

    const endPointer = (e: PointerEvent): void => {
      const wasDragging = dragging && pointers.size === 1;
      pointers.delete(e.pointerId);
      canvas.releasePointerCapture?.(e.pointerId);
      if (pointers.size < 2) pinchDist = 0;
      if (pointers.size === 0) {
        dragging = false;
        if (wasDragging && !moved) {
          const p = localPoint(e);
          engine.clickAt(p.x, p.y);
        }
      }
    };

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const p = localPoint(e);
      engine.zoomBy(-e.deltaY * 0.002, p);
    };

    const onKeyDown = (e: KeyboardEvent): void => {
      const step = panStep() * dpr;
      switch (e.key) {
        case 'ArrowLeft':
          engine.panByPixels(-step, 0);
          break;
        case 'ArrowRight':
          engine.panByPixels(step, 0);
          break;
        case 'ArrowUp':
          engine.panByPixels(0, -step);
          break;
        case 'ArrowDown':
          engine.panByPixels(0, step);
          break;
        case '+':
        case '=':
          engine.zoomBy(zoomStep());
          break;
        case '-':
        case '_':
          engine.zoomBy(-zoomStep());
          break;
        default:
          return;
      }
      e.preventDefault();
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    container.addEventListener('keydown', onKeyDown);

    onCleanup(() => {
      offMove();
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', endPointer);
      canvas.removeEventListener('pointercancel', endPointer);
      canvas.removeEventListener('wheel', onWheel);
      container.removeEventListener('keydown', onKeyDown);
      engine.detach();
    });
  });

  const readout = (): string => {
    const v = viewState();
    return tFn()('map.readout', {
      lat: fmtDeg(v.lat),
      lon: fmtDeg(v.lon),
      zoom: v.zoom.toFixed(1),
    });
  };

  return (
    <div
      class="mvp-map"
      ref={container}
      tabindex="0"
      role="application"
      aria-label={tFn()('map.a11y.label')}
    >
      <canvas class="mvp-map__canvas" ref={canvas} aria-hidden="true" />
      <div class="mvp-map__controls">
        <button
          type="button"
          class="mvp-map__btn"
          aria-label={tFn()('map.zoomIn')}
          onClick={(): void => props.engine.zoomBy(zoomStep())}
        >
          +
        </button>
        <button
          type="button"
          class="mvp-map__btn"
          aria-label={tFn()('map.zoomOut')}
          onClick={(): void => props.engine.zoomBy(-zoomStep())}
        >
          &minus;
        </button>
      </div>
      <p class="mvp-map__readout" aria-live="polite">
        {readout()}
      </p>
      <Show when={scaleBar().pixels >= 1}>
        <div
          class="mvp-map__scale"
          role="img"
          aria-label={tFn()('map.scale.a11y', { distance: scaleBar().label })}
          style={{ width: `${Math.round(scaleBar().pixels)}px` }}
        >
          <span class="mvp-map__scale-label" aria-hidden="true">
            {scaleBar().label}
          </span>
        </div>
      </Show>
      <span class="mvp-map__attribution">{tFn()('map.attribution')}</span>
    </div>
  );
};

/** Re-export the engine point type for consumers wiring `on('click', …)`. */
export type { LatLon };
