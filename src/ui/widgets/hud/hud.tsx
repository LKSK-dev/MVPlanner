/**
 * HUD widget (task T2.1; spec plan/04 §4.2 HUD, plan/05 §5.4/§5.5/§5.8).
 *
 * A canvas-rendered artificial-horizon head-up display. It binds to a REACTIVE
 * `vehicle` accessor (the Flight screen / T2.11 wires the store selector — this
 * widget never reaches into the store or context itself) and an optional
 * STATUSTEXT accessor, and paints an attitude horizon + pitch ladder, heading
 * tape, speed/altitude/climb/throttle/battery/GPS/EKF/vibe readouts, the flight
 * mode, a prominent ARMED state, the time and a STATUSTEXT ticker.
 *
 * Rendering runs in a `requestAnimationFrame` loop capped at the display
 * refresh, but it only rebuilds + repaints when a cheap input signature changes
 * (or the canvas resizes) — see {@link hudSignature}. The canvas is fitted to
 * its container via `ResizeObserver` and is HiDPI-aware.
 *
 * Accessibility (spec §5.8): the canvas carries `role="img"` with a live textual
 * summary, and a visually-hidden `aria-live` paragraph mirrors the same
 * mode/armed/altitude/speed/battery summary for screen readers.
 *
 * The heavy imperative drawing lives in `./render`; the geometry/formatting in
 * `./model`. Both are pure and unit-tested independently of the canvas.
 */
import { createMemo, onCleanup, onMount, type Component } from 'solid-js';
import { t as defaultT } from '../../../core/i18n';
import { readHudColors } from './colors';
import { buildHudModel, hudA11ySummary, hudSignature, type HudColors } from './model';
import { buildHudLabels } from './messages';
import { drawHud } from './render';
import type { StatusTextAccessor, TFn, VehicleAccessor } from './types';

/** {@link Hud} props. */
export interface HudProps {
  /**
   * Reactive accessor for the vehicle to display, or `undefined` when none is
   * selected/connected (drives the empty state). The widget does NOT read the
   * store directly — the Flight screen supplies the selector.
   */
  vehicle: VehicleAccessor;
  /** Optional reactive STATUSTEXT ticker line. */
  statusText?: StatusTextAccessor;
  /** Optional palette override; defaults to reading `--mvp-*` CSS tokens. */
  colors?: () => HudColors;
  /** Clock for the time readout (default `Date.now`). */
  now?: () => number;
  /** i18n translate function (default the app `t`). */
  t?: TFn;
}

/** Pick the active `requestAnimationFrame`, or a no-op when unavailable. */
function raf(cb: FrameRequestCallback): number {
  return typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : 0;
}

/** Cancel a scheduled frame (best-effort). */
function caf(id: number): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
}

/** The canvas artificial-horizon HUD. */
export const Hud: Component<HudProps> = (props) => {
  const tFn = (): TFn => props.t ?? defaultT;
  const nowFn = (): number => (props.now ?? Date.now)();
  const labels = createMemo(() => buildHudLabels(tFn()));

  // Reactive textual summary for screen readers (independent of the canvas
  // loop, so it updates on every vehicle/status/locale change).
  const a11ySummary = createMemo(() => hudA11ySummary(props.vehicle(), labels()));

  let container!: HTMLDivElement;
  let canvas!: HTMLCanvasElement;

  onMount(() => {
    const ctx = canvas.getContext('2d');
    const view = container.ownerDocument.defaultView;
    const dpr = view?.devicePixelRatio && view.devicePixelRatio > 0 ? view.devicePixelRatio : 1;

    const resize = (): void => {
      const rect = container.getBoundingClientRect();
      const cssW = Math.max(1, Math.floor(rect.width));
      const cssH = Math.max(1, Math.floor(rect.height));
      const dw = Math.max(1, Math.round(cssW * dpr));
      const dh = Math.max(1, Math.round(cssH * dpr));
      if (canvas.width !== dw || canvas.height !== dh) {
        canvas.width = dw;
        canvas.height = dh;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
      }
    };

    let observer: ResizeObserver | undefined;
    if (view && typeof view.ResizeObserver === 'function') {
      observer = new view.ResizeObserver(() => resize());
      observer.observe(container);
    }
    resize();

    let rafId = 0;
    let lastSig: string | undefined;
    let lastW = -1;
    let lastH = -1;

    const frame = (): void => {
      const now = nowFn();
      const vehicle = props.vehicle();
      const status = props.statusText?.();
      const sig = hudSignature(vehicle, status, Math.floor(now / 1000));
      const sizeChanged = canvas.width !== lastW || canvas.height !== lastH;
      if (sig !== lastSig || sizeChanged) {
        lastSig = sig;
        lastW = canvas.width;
        lastH = canvas.height;
        const model = buildHudModel(vehicle, status, now, labels());
        const palette = props.colors?.() ?? readHudColors(container);
        drawHud(ctx, model, palette, labels(), canvas.width, canvas.height);
      }
      rafId = raf(frame);
    };

    frame();

    onCleanup(() => {
      caf(rafId);
      observer?.disconnect();
    });
  });

  return (
    <div class="mvp-hud" ref={container}>
      <canvas
        class="mvp-hud__canvas"
        ref={canvas}
        role="img"
        aria-label={tFn()('hud.a11y.summary', { summary: a11ySummary() })}
      />
      <p class="mvp-hud__a11y" aria-live="polite">
        {a11ySummary()}
      </p>
    </div>
  );
};
