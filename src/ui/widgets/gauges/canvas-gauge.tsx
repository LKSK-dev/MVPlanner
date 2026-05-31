/**
 * Shared canvas-gauge shell (task T2.2; spec plan/04 §4.2, plan/05 §5.5/§5.8).
 *
 * Wraps a `<canvas>` plus an always-present textual readout in a `<figure>` so
 * the small instrument dials (attitude/compass/VSI) stay accessible (a label +
 * text value, never color-only — spec §5.8). The reactive {@link CanvasGaugeProps.text}
 * drives the caption; the {@link CanvasGaugeProps.draw} closure redraws inside a
 * Solid effect, so reading the vehicle accessor there re-paints on every patch.
 *
 * The 2D context is fetched defensively: under happy-dom `getContext('2d')`
 * returns `null` (a stub), so the draw pass is skipped and the textual readout
 * is what component tests assert on.
 */
import { createEffect, onMount, type Component } from 'solid-js';
import type { TFn } from './types';

/** {@link CanvasGauge} props. */
export interface CanvasGaugeProps {
  /** i18n key for the gauge title. */
  labelKey: string;
  /** i18n translate function. */
  t: TFn;
  /** Reactive textual readout (the accessible equivalent of the dial). */
  text: () => string;
  /** Paint the dial onto the 2D context at logical `w × h` (CSS px). */
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  /** Square logical size in CSS px (default 96). */
  size?: number;
}

/** Default logical gauge size in CSS pixels. */
const DEFAULT_SIZE = 96;

/** Safely obtain a 2D context (returns `null` on stub/unsupported canvases). */
function get2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  try {
    return canvas.getContext('2d');
  } catch {
    return null;
  }
}

/** A small canvas instrument with an accessible label + live text readout. */
export const CanvasGauge: Component<CanvasGaugeProps> = (props) => {
  let canvas: HTMLCanvasElement | undefined;
  const size = (): number => props.size ?? DEFAULT_SIZE;

  onMount(() => {
    createEffect(() => {
      const el = canvas;
      if (el === undefined) return;
      const s = size();
      const dpr = typeof globalThis.devicePixelRatio === 'number' ? globalThis.devicePixelRatio : 1;
      el.width = Math.round(s * dpr);
      el.height = Math.round(s * dpr);
      const ctx = get2d(el);
      if (ctx === null) return; // happy-dom / unsupported: text readout still updates.
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, s, s);
      props.draw(ctx, s, s);
      ctx.restore();
    });
  });

  return (
    <figure class="mvp-gauge mvp-gauge--canvas" role="group" aria-label={props.t(props.labelKey)}>
      <canvas
        ref={canvas}
        class="mvp-gauge__canvas"
        style={{ width: `${size()}px`, height: `${size()}px` }}
        aria-hidden="true"
      />
      <figcaption class="mvp-gauge__caption">
        <span class="mvp-gauge__title">{props.t(props.labelKey)}</span>
        <span class="mvp-gauge__value">{props.text()}</span>
      </figcaption>
    </figure>
  );
};
