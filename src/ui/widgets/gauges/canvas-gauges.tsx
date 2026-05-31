/**
 * Canvas instrument dials: attitude, compass/heading, VSI/climb (task T2.2;
 * spec plan/04 §4.2). Geometry comes from the pure `geometry.ts` helpers; this
 * module only adds the `ctx` draw passes + the accessible text readouts.
 *
 * Colours are read from the active theme's CSS custom properties at draw time
 * so the dials track theme switches without hard-coded palettes (spec §5.6).
 */
import { type Component } from 'solid-js';
import { CanvasGauge } from './canvas-gauge';
import {
  attitudeGeometry,
  compassGeometry,
  vsiGeometry,
  type AttitudeGeometry,
  type CompassGeometry,
  type VsiGeometry,
} from './geometry';
import { cardinalKey, formatDegrees, formatHeadingDeg } from './format';
import type { GaugeProps } from './types';

/** Read a theme color token (falls back to a sane default off-DOM). */
function token(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

/* -------------------------------------------------------------- attitude */

function drawAttitude(ctx: CanvasRenderingContext2D, g: AttitudeGeometry): void {
  const sky = token('--mvp-accent', '#3fb6ff');
  const ground = token('--mvp-warn', '#d29922');
  const ink = token('--mvp-text', '#e6edf3');

  ctx.save();
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, g.radius - 1, 0, Math.PI * 2);
  ctx.clip();

  ctx.translate(g.cx, g.cy);
  ctx.rotate(g.rollRad);
  ctx.translate(0, g.pitchOffset);

  const span = g.radius * 2;
  ctx.fillStyle = sky;
  ctx.fillRect(-span, -span, span * 2, span);
  ctx.fillStyle = ground;
  ctx.fillRect(-span, 0, span * 2, span);

  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-span, 0);
  ctx.lineTo(span, 0);
  ctx.stroke();
  ctx.restore();

  // Fixed centre reference.
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(g.cx - g.radius / 3, g.cy);
  ctx.lineTo(g.cx + g.radius / 3, g.cy);
  ctx.stroke();
}

/** Mini artificial-horizon (attitude) gauge. */
export const AttitudeGauge: Component<GaugeProps> = (props) => {
  const text = (): string => {
    const v = props.vehicle();
    if (v === undefined) return props.t('gauges.value.none');
    const deg = props.t('gauges.unit.deg');
    return `${props.t('gauges.roll')} ${formatDegrees(v.attitude.rollRad)}${deg} · ${props.t(
      'gauges.pitch',
    )} ${formatDegrees(v.attitude.pitchRad)}${deg}`;
  };
  return (
    <CanvasGauge
      labelKey="gauges.attitude.title"
      t={props.t}
      text={text}
      draw={(ctx, w, h): void => {
        const a = props.vehicle()?.attitude;
        drawAttitude(ctx, attitudeGeometry(a?.rollRad ?? 0, a?.pitchRad ?? 0, w, h));
      }}
    />
  );
};

/* --------------------------------------------------------------- compass */

function drawCompass(ctx: CanvasRenderingContext2D, g: CompassGeometry): void {
  const ink = token('--mvp-text', '#e6edf3');
  const dim = token('--mvp-text-dim', '#9aa7b4');
  const accent = token('--mvp-accent', '#3fb6ff');

  ctx.strokeStyle = dim;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, g.radius - 1, 0, Math.PI * 2);
  ctx.stroke();

  // Rotate the rose so the current heading is up.
  ctx.save();
  ctx.translate(g.cx, g.cy);
  ctx.rotate((-g.headingDeg * Math.PI) / 180);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  for (let i = 0; i < 8; i += 1) {
    const a = (i * Math.PI) / 4;
    const r0 = g.radius - (i % 2 === 0 ? 10 : 6);
    ctx.beginPath();
    ctx.moveTo(Math.sin(a) * r0, -Math.cos(a) * r0);
    ctx.lineTo(Math.sin(a) * (g.radius - 2), -Math.cos(a) * (g.radius - 2));
    ctx.stroke();
  }
  ctx.restore();

  // Fixed north-pointer (lubber line).
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(g.cx, g.cy);
  ctx.lineTo(g.cx, g.cy - g.radius + 4);
  ctx.stroke();
}

/** Compass / heading gauge. */
export const CompassGauge: Component<GaugeProps> = (props) => {
  const text = (): string => {
    const v = props.vehicle();
    if (v === undefined) return props.t('gauges.value.none');
    return `${formatHeadingDeg(v.attitude.yawRad)}${props.t('gauges.unit.deg')} ${props.t(
      cardinalKey(v.attitude.yawRad),
    )}`;
  };
  return (
    <CanvasGauge
      labelKey="gauges.compass.title"
      t={props.t}
      text={text}
      draw={(ctx, w, h): void => {
        const yaw = props.vehicle()?.attitude.yawRad ?? 0;
        drawCompass(ctx, compassGeometry(yaw, w, h));
      }}
    />
  );
};

/* ------------------------------------------------------------------- VSI */

function drawVsi(ctx: CanvasRenderingContext2D, g: VsiGeometry): void {
  const ink = token('--mvp-text', '#e6edf3');
  const dim = token('--mvp-text-dim', '#9aa7b4');
  const accent = token('--mvp-accent', '#3fb6ff');

  ctx.strokeStyle = dim;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(g.cx, g.cy, g.radius - 1, 0, Math.PI * 2);
  ctx.stroke();

  // Zero reference tick (needle-up).
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(g.cx, g.cy - g.radius + 2);
  ctx.lineTo(g.cx, g.cy - g.radius + 10);
  ctx.stroke();

  // Needle.
  ctx.strokeStyle = accent;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(g.cx, g.cy);
  ctx.lineTo(
    g.cx + Math.cos(g.needleRad) * (g.radius - 8),
    g.cy + Math.sin(g.needleRad) * (g.radius - 8),
  );
  ctx.stroke();
}

/** Vertical-speed indicator (climb) gauge. */
export const VsiGauge: Component<GaugeProps> = (props) => {
  const text = (): string => {
    const v = props.vehicle();
    if (v?.velocity === undefined) return props.t('gauges.value.none');
    const c = props.units.climb(v.velocity.climbMs);
    return `${c.value} ${props.t(c.unitKey)}`;
  };
  return (
    <CanvasGauge
      labelKey="gauges.vsi.title"
      t={props.t}
      text={text}
      draw={(ctx, w, h): void => {
        const climb = props.vehicle()?.velocity?.climbMs ?? 0;
        drawVsi(ctx, vsiGeometry(climb, w, h));
      }}
    />
  );
};
