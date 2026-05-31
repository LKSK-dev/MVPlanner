/**
 * Thin `<canvas>` 2D drawing helpers for the overlay layers (task T2.4). This is
 * the **canvas-deferred** half of the overlays: under happy-dom
 * `canvas.getContext('2d')` is `null`, so layers compute their geometry (pure,
 * tested in `./geometry`) and then bail before reaching here. Pixels are
 * exercised by the live e2e/perf rig (M2 gate), not asserted in unit tests; a
 * recording stub context is used only to smoke the call sequence.
 *
 * None of these helpers throw on degenerate input (too few points, zero radius).
 */
import type { ScreenPoint } from './geometry';

/** Stroke (and optionally close/fill) a polyline of device-pixel points. */
export function strokePath(
  g: CanvasRenderingContext2D,
  pts: readonly ScreenPoint[],
  opts: { stroke: string; width?: number; fill?: string; close?: boolean; dash?: number[] },
): void {
  if (pts.length < 2) return;
  const first = pts[0];
  if (!first) return;
  g.save();
  g.beginPath();
  g.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p) g.lineTo(p[0], p[1]);
  }
  if (opts.close) g.closePath();
  if (opts.fill) {
    g.fillStyle = opts.fill;
    g.fill();
  }
  if (opts.dash) g.setLineDash(opts.dash);
  g.lineWidth = opts.width ?? 2;
  g.strokeStyle = opts.stroke;
  g.stroke();
  g.restore();
}

/** Fill + stroke a closed polygon of device-pixel vertices (e.g. the vehicle icon). */
export function fillPolygon(
  g: CanvasRenderingContext2D,
  pts: readonly ScreenPoint[],
  opts: { fill: string; stroke?: string; width?: number },
): void {
  if (pts.length < 3) return;
  const first = pts[0];
  if (!first) return;
  g.save();
  g.beginPath();
  g.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p) g.lineTo(p[0], p[1]);
  }
  g.closePath();
  g.fillStyle = opts.fill;
  g.fill();
  if (opts.stroke) {
    g.lineWidth = opts.width ?? 1.5;
    g.strokeStyle = opts.stroke;
    g.stroke();
  }
  g.restore();
}

/** Draw a filled disc with an optional outline at a device-pixel centre. */
export function drawDisc(
  g: CanvasRenderingContext2D,
  center: ScreenPoint,
  radiusPx: number,
  opts: { fill: string; stroke?: string; width?: number },
): void {
  if (radiusPx <= 0) return;
  g.save();
  g.beginPath();
  g.arc(center[0], center[1], radiusPx, 0, Math.PI * 2);
  g.fillStyle = opts.fill;
  g.fill();
  if (opts.stroke) {
    g.lineWidth = opts.width ?? 1.5;
    g.strokeStyle = opts.stroke;
    g.stroke();
  }
  g.restore();
}

/** Stroke a circle outline (e.g. a fence/rally radius) at a device-pixel centre. */
export function strokeCircle(
  g: CanvasRenderingContext2D,
  center: ScreenPoint,
  radiusPx: number,
  opts: { stroke: string; width?: number; fill?: string; dash?: number[] },
): void {
  if (radiusPx <= 0) return;
  g.save();
  g.beginPath();
  g.arc(center[0], center[1], radiusPx, 0, Math.PI * 2);
  if (opts.fill) {
    g.fillStyle = opts.fill;
    g.fill();
  }
  if (opts.dash) g.setLineDash(opts.dash);
  g.lineWidth = opts.width ?? 1.5;
  g.strokeStyle = opts.stroke;
  g.stroke();
  g.restore();
}

/** Draw a short text label offset from a device-pixel anchor. */
export function drawLabel(
  g: CanvasRenderingContext2D,
  anchor: ScreenPoint,
  text: string,
  opts: { color: string; dx?: number; dy?: number; font?: string },
): void {
  if (!text) return;
  g.save();
  g.font = opts.font ?? '12px system-ui, sans-serif';
  g.fillStyle = opts.color;
  g.textBaseline = 'middle';
  g.fillText(text, anchor[0] + (opts.dx ?? 8), anchor[1] + (opts.dy ?? 0));
  g.restore();
}
