/**
 * Pure canvas geometry for the canvas gauges (task T2.2; spec plan/04 §4.2).
 *
 * These helpers compute the numbers a 2D draw pass needs (centre, radius,
 * offsets, needle angle) WITHOUT touching a `CanvasRenderingContext2D`. Keeping
 * geometry separate from the `ctx` calls makes it unit-testable under happy-dom,
 * whose `<canvas>` 2D context is a stub (`getContext('2d')` returns `null`).
 */

/** Clamp `v` into the inclusive `[min, max]` range. */
export function clamp(v: number, min: number, max: number): number {
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/** Radians → degrees. */
export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Normalise an angle (radians) to a `[0, 360)` degree heading. */
export function normalizeHeadingDeg(yawRad: number): number {
  const deg = radToDeg(yawRad) % 360;
  return deg < 0 ? deg + 360 : deg;
}

/** Geometry for the mini artificial-horizon (attitude) gauge. */
export interface AttitudeGeometry {
  /** Centre x. */
  cx: number;
  /** Centre y. */
  cy: number;
  /** Instrument radius (px). */
  radius: number;
  /** Roll angle (radians) the draw pass rotates the horizon by. */
  rollRad: number;
  /** Signed vertical offset (px) of the horizon for pitch (down = positive). */
  pitchOffset: number;
}

/** Pitch magnitude (radians) mapped to a full-radius horizon offset (±60°). */
export const ATTITUDE_PITCH_FOV_RAD = Math.PI / 3;

/** Compute the attitude (artificial-horizon) geometry for a `w × h` surface. */
export function attitudeGeometry(
  rollRad: number,
  pitchRad: number,
  w: number,
  h: number,
): AttitudeGeometry {
  const radius = Math.min(w, h) / 2;
  const clampedPitch = clamp(pitchRad, -ATTITUDE_PITCH_FOV_RAD, ATTITUDE_PITCH_FOV_RAD);
  const pitchOffset = (clampedPitch / ATTITUDE_PITCH_FOV_RAD) * radius;
  return { cx: w / 2, cy: h / 2, radius, rollRad, pitchOffset };
}

/** Geometry for the compass / heading gauge. */
export interface CompassGeometry {
  cx: number;
  cy: number;
  radius: number;
  /** Heading in `[0, 360)` degrees the rose is rotated to. */
  headingDeg: number;
}

/** Compute the compass geometry for a `w × h` surface. */
export function compassGeometry(yawRad: number, w: number, h: number): CompassGeometry {
  return {
    cx: w / 2,
    cy: h / 2,
    radius: Math.min(w, h) / 2,
    headingDeg: normalizeHeadingDeg(yawRad),
  };
}

/** Geometry for the vertical-speed indicator (VSI / climb) gauge. */
export interface VsiGeometry {
  cx: number;
  cy: number;
  radius: number;
  /** Needle angle in radians (canvas convention: `-π/2` points up). */
  needleRad: number;
  /** Climb rate clamped to the dial range (m/s). */
  climb: number;
}

/** Default full-scale climb rate (±m/s) for {@link vsiGeometry}. */
export const VSI_MAX_DEFAULT_MS = 5;

/** Total needle sweep (radians) across the full ±range (270°). */
export const VSI_SWEEP_RAD = (3 * Math.PI) / 2;

/**
 * Compute the VSI needle geometry. The needle points up (`-π/2`) at zero climb
 * and sweeps symmetrically ±{@link VSI_SWEEP_RAD}/2 toward the ±`maxMs` limits.
 */
export function vsiGeometry(
  climbMs: number,
  w: number,
  h: number,
  maxMs: number = VSI_MAX_DEFAULT_MS,
): VsiGeometry {
  const range = maxMs > 0 ? maxMs : VSI_MAX_DEFAULT_MS;
  const climb = clamp(climbMs, -range, range);
  const frac = (climb + range) / (2 * range); // 0..1, 0.5 at zero climb
  const needleRad = -Math.PI / 2 + (frac - 0.5) * VSI_SWEEP_RAD;
  return { cx: w / 2, cy: h / 2, radius: Math.min(w, h) / 2, needleRad, climb };
}
