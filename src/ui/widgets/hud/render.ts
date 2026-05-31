/**
 * Canvas 2d HUD renderer (task T2.1; spec plan/04 §4.2 HUD, plan/05 §5.5).
 *
 * This module owns ALL imperative `CanvasRenderingContext2D` calls; the numbers
 * and strings it paints come from the pure `./model` and `./colors` modules so
 * the geometry/formatting stay unit-testable on their own. Under happy-dom the
 * 2d context is `null`, so the caller skips this entirely — these functions are
 * the "canvas-deferred" part of the widget (covered by the live e2e/perf rig in
 * the milestone gate, not by happy-dom unit tests).
 *
 * All coordinates are in device pixels (`w`,`h` already include devicePixelRatio
 * scaling applied by the component).
 */
import type { HudColors, HudLabels, HudModel } from './model';
import { headingTapeTicks, pitchLadderRungs, pitchPixels, radToDeg } from './model';

/** Degrees of pitch that fill the canvas height (±30° visible). */
const VISIBLE_PITCH_RANGE = 60;

/** Pick a readable font size from the canvas height. */
function fontPx(h: number): number {
  return Math.max(11, Math.round(h * 0.034));
}

/** Draw a `LABEL value` pair anchored at (x, y) with the given alignment. */
function drawReadout(
  ctx: CanvasRenderingContext2D,
  colors: HudColors,
  label: string,
  value: string,
  x: number,
  y: number,
  align: CanvasTextAlign,
  fs: number,
): void {
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${Math.round(fs * 0.8)}px var(--mvp-font-mono, monospace)`;
  ctx.fillStyle = colors.textDim;
  ctx.fillText(label, x, y);
  ctx.font = `${fs}px var(--mvp-font-mono, monospace)`;
  ctx.fillStyle = colors.text;
  ctx.fillText(value, x, y + fs);
}

/** Sky/ground/horizon + pitch ladder, rotated by roll and shifted by pitch. */
function drawAttitude(
  ctx: CanvasRenderingContext2D,
  model: HudModel,
  colors: HudColors,
  w: number,
  h: number,
): void {
  const cx = w / 2;
  const cy = h / 2;
  const pxPerDeg = h / VISIBLE_PITCH_RANGE;
  const big = Math.max(w, h) * 2;
  const pitchDeg = radToDeg(model.pitchRad);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(-model.rollRad);
  ctx.translate(0, pitchPixels(model.pitchRad, pxPerDeg));

  ctx.fillStyle = colors.sky;
  ctx.fillRect(-big, -big, big * 2, big);
  ctx.fillStyle = colors.ground;
  ctx.fillRect(-big, 0, big * 2, big);

  ctx.strokeStyle = colors.horizon;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-big, 0);
  ctx.lineTo(big, 0);
  ctx.stroke();

  // Pitch ladder rungs.
  ctx.strokeStyle = colors.ladder;
  ctx.fillStyle = colors.ladder;
  ctx.lineWidth = 1.5;
  const fs = Math.round(fontPx(h) * 0.7);
  ctx.font = `${fs}px var(--mvp-font-mono, monospace)`;
  ctx.textBaseline = 'middle';
  const half = w * 0.12;
  for (const rung of pitchLadderRungs(pitchDeg)) {
    const y = -rung.deg * pxPerDeg;
    ctx.beginPath();
    ctx.moveTo(-half, y);
    ctx.lineTo(half, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(String(rung.label), -half - 4, y);
    ctx.textAlign = 'left';
    ctx.fillText(String(rung.label), half + 4, y);
  }
  ctx.restore();
}

/** Fixed aircraft reticle at screen centre. */
function drawReticle(ctx: CanvasRenderingContext2D, colors: HudColors, w: number, h: number): void {
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.max(8, h * 0.02);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - r * 2.5, cy);
  ctx.lineTo(cx - r, cy);
  ctx.moveTo(cx + r, cy);
  ctx.lineTo(cx + r * 2.5, cy);
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx, cy);
  ctx.stroke();
}

/** Heading tape across the top with a centre pointer. */
function drawHeadingTape(
  ctx: CanvasRenderingContext2D,
  model: HudModel,
  colors: HudColors,
  w: number,
  h: number,
): void {
  const cx = w / 2;
  const top = Math.round(h * 0.06);
  const pxPerDeg = w / 110; // ±45° across most of the width
  const fs = Math.round(fontPx(h) * 0.7);
  ctx.font = `${fs}px var(--mvp-font-mono, monospace)`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.strokeStyle = colors.textDim;
  ctx.fillStyle = colors.text;
  ctx.lineWidth = 1;
  for (const tick of headingTapeTicks(model.headingDeg)) {
    const x = cx + tick.deltaDeg * pxPerDeg;
    if (x < 4 || x > w - 4) continue;
    const len = tick.major ? 10 : 5;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, top + len);
    ctx.stroke();
    if (tick.major) ctx.fillText(String(tick.deg), x, top + len + 2);
  }
  // Centre heading pointer + numeric.
  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.moveTo(cx, top - 6);
  ctx.lineTo(cx - 6, top - 14);
  ctx.lineTo(cx + 6, top - 14);
  ctx.closePath();
  ctx.fill();
  ctx.font = `${fontPx(h)}px var(--mvp-font-mono, monospace)`;
  ctx.fillStyle = colors.text;
  ctx.textBaseline = 'bottom';
  ctx.fillText(model.readouts.heading, cx, top - 16);
}

/** Mode + the prominent ARMED/DISARMED state badge, centred near the top. */
function drawArmedState(
  ctx: CanvasRenderingContext2D,
  model: HudModel,
  colors: HudColors,
  labels: HudLabels,
  w: number,
  h: number,
): void {
  const fs = fontPx(h);
  const y = Math.round(h * 0.06);
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.font = `${fs}px var(--mvp-font-mono, monospace)`;
  ctx.fillStyle = colors.text;
  ctx.fillText(model.mode, 8, y);

  const word = model.armed ? labels.armed : labels.disarmed;
  ctx.font = `bold ${fs}px var(--mvp-font-mono, monospace)`;
  ctx.textAlign = 'right';
  if (model.armed) {
    const padX = 6;
    const tw = ctx.measureText(word).width;
    ctx.fillStyle = colors.error;
    ctx.fillRect(w - 8 - tw - padX * 2, y - 2, tw + padX * 2, fs + 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(word, w - 8 - padX, y);
  } else {
    ctx.fillStyle = colors.ok;
    ctx.fillText(word, w - 8, y);
  }
}

/** All numeric readouts around the edges. */
function drawReadouts(
  ctx: CanvasRenderingContext2D,
  model: HudModel,
  colors: HudColors,
  labels: HudLabels,
  w: number,
  h: number,
): void {
  const fs = fontPx(h);
  const r = model.readouts;
  const midY = h * 0.4;
  const lineH = fs * 2.2;
  // Left: speeds.
  drawReadout(ctx, colors, labels.airspeed, r.airspeed, 8, midY, 'left', fs);
  drawReadout(ctx, colors, labels.groundspeed, r.groundspeed, 8, midY + lineH, 'left', fs);
  // Right: altitude + climb.
  drawReadout(ctx, colors, labels.altRel, r.altRel, w - 8, midY, 'right', fs);
  drawReadout(ctx, colors, labels.altAmsl, r.altAmsl, w - 8, midY + lineH, 'right', fs);
  drawReadout(ctx, colors, labels.climb, r.climb, w - 8, midY + lineH * 2, 'right', fs);
  // Bottom-left: throttle, battery, GPS.
  const bottom = h - 12 - fs;
  drawReadout(ctx, colors, labels.throttle, r.throttle, 8, bottom - lineH * 2, 'left', fs);
  drawReadout(ctx, colors, labels.battery, r.battery, 8, bottom - lineH, 'left', fs);
  drawReadout(ctx, colors, labels.gps, r.gps, 8, bottom, 'left', fs);
  // Bottom-right: EKF, vibe, time.
  drawReadout(ctx, colors, labels.ekf, r.ekf, w - 8, bottom - lineH * 2, 'right', fs);
  drawReadout(ctx, colors, labels.vibe, r.vibe, w - 8, bottom - lineH, 'right', fs);
  drawReadout(ctx, colors, labels.time, r.time, w - 8, bottom, 'right', fs);
}

/** STATUSTEXT ticker line along the very bottom. */
function drawStatusText(
  ctx: CanvasRenderingContext2D,
  model: HudModel,
  colors: HudColors,
  w: number,
  h: number,
): void {
  if (model.statusText.length === 0) return;
  const fs = Math.round(fontPx(h) * 0.85);
  ctx.font = `${fs}px var(--mvp-font-mono, monospace)`;
  ctx.fillStyle = colors.warn;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(model.statusText, w / 2, h - 2);
}

/** Empty-state placeholder when no vehicle data is bound yet. */
function drawEmpty(
  ctx: CanvasRenderingContext2D,
  model: HudModel,
  colors: HudColors,
  w: number,
  h: number,
): void {
  ctx.fillStyle = colors.textDim;
  ctx.font = `${fontPx(h)}px var(--mvp-font-mono, monospace)`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(model.a11ySummary, w / 2, h / 2);
}

/**
 * Render one HUD frame into `ctx`. Clears the canvas first. Safe to call with a
 * falsy context (no-op) so callers need not double-guard.
 */
export function drawHud(
  ctx: CanvasRenderingContext2D | null | undefined,
  model: HudModel,
  colors: HudColors,
  labels: HudLabels,
  w: number,
  h: number,
): void {
  if (!ctx || w <= 0 || h <= 0) return;
  ctx.clearRect(0, 0, w, h);

  if (!model.hasVehicle) {
    ctx.fillStyle = colors.ground;
    ctx.fillRect(0, 0, w, h);
    drawEmpty(ctx, model, colors, w, h);
    return;
  }

  drawAttitude(ctx, model, colors, w, h);
  drawReticle(ctx, colors, w, h);
  drawHeadingTape(ctx, model, colors, w, h);
  drawArmedState(ctx, model, colors, labels, w, h);
  drawReadouts(ctx, model, colors, labels, w, h);
  drawStatusText(ctx, model, colors, w, h);
}
