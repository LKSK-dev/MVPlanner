/**
 * Pure gamepad-axis → MAVLink transforms for the manual-control microservice
 * (task T8.6; spec plan/04 §4.2 joystick).
 *
 * Everything here is a side-effect-free function of its inputs, so the shaping
 * pipeline (deadzone → expo → reverse → trim) and the channel/axis encoders are
 * unit-tested without a Gamepad API, a Worker, or a clock. The service composes
 * these to build `RC_CHANNELS_OVERRIDE` (µs pulses) or `MANUAL_CONTROL`
 * (−1000…1000) frames.
 */

/**
 * Per-axis shaping parameters applied to a raw, normalised gamepad axis value
 * in `[-1, 1]`. The pipeline order is deadzone → expo → reverse → trim.
 */
export interface AxisShape {
  /** Invert the axis after deadzone + expo (applied before {@link AxisShape.trim}). */
  reverse: boolean;
  /** Fraction of the centre travel ignored, `0…1`; values inside become `0`. */
  deadzone: number;
  /** Exponential softening of centre response, `0…1` (`0` = linear, `1` = cubic). */
  expo: number;
  /** Constant offset added after shaping, `-1…1`; result is re-clamped to `[-1, 1]`. */
  trim: number;
}

/** A neutral shape: no deadzone, linear, not reversed, no trim. */
export const NEUTRAL_SHAPE: AxisShape = { reverse: false, deadzone: 0, expo: 0, trim: 0 };

/** RC pulse-width output range (µs) for a single override channel. */
export interface PulseRange {
  /** Minimum pulse at axis `-1` (default 1000). */
  min: number;
  /** Centre pulse at axis `0` (default 1500). */
  center: number;
  /** Maximum pulse at axis `+1` (default 2000). */
  max: number;
}

/** Default RC pulse range: 1000 / 1500 / 2000 µs. */
export const DEFAULT_PULSE_RANGE: PulseRange = { min: 1000, center: 1500, max: 2000 };

/** `MANUAL_CONTROL` axis full-scale magnitude (`x`/`y`/`z`/`r` span `-1000…1000`). */
export const MANUAL_FULL_SCALE = 1000;

/**
 * `RC_CHANNELS_OVERRIDE` sentinel meaning "ignore this channel" (fall back to
 * the RC link). `0` and `UINT16_MAX` both release a channel.
 */
export const RC_OVERRIDE_IGNORE = 0;
/** Alternative ignore sentinel (`UINT16_MAX`) accepted by {@link isIgnoredPulse}. */
export const RC_OVERRIDE_IGNORE_MAX = 65535;

/** Clamp `v` into `[lo, hi]`. */
export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * True when `pulse` is an RC-override "ignore" sentinel (`0` or `65535`), i.e.
 * the channel is released to the physical RC link rather than overridden.
 */
export function isIgnoredPulse(pulse: number): boolean {
  return pulse === RC_OVERRIDE_IGNORE || pulse === RC_OVERRIDE_IGNORE_MAX;
}

/**
 * Apply the shaping pipeline to a raw normalised axis value.
 *
 * Steps: clamp to `[-1, 1]` → deadzone (rescaled so the live band still spans
 * the full range) → cubic expo blend → reverse → trim (re-clamped). Returns a
 * normalised value in `[-1, 1]`.
 */
export function shapeAxis(raw: number, shape: AxisShape): number {
  let v = clamp(raw, -1, 1);

  // Deadzone: ignore tiny centre travel, then rescale the remaining band to the
  // full [0, 1] magnitude so the stick still reaches the extremes.
  const dz = clamp(shape.deadzone, 0, 1);
  if (dz > 0) {
    if (dz >= 1) {
      v = 0;
    } else {
      const mag = Math.abs(v);
      v = mag <= dz ? 0 : Math.sign(v) * ((mag - dz) / (1 - dz));
    }
  }

  // Expo: blend linear with cubic for softer centre response.
  const expo = clamp(shape.expo, 0, 1);
  if (expo > 0) v = (1 - expo) * v + expo * v * v * v;

  if (shape.reverse) v = -v;

  if (shape.trim !== 0) v = clamp(v + shape.trim, -1, 1);

  return clamp(v, -1, 1);
}

/**
 * Map a shaped axis value in `[-1, 1]` to an RC pulse width (µs) within
 * `range`. The mapping is piecewise so an asymmetric centre still hits `min` at
 * `-1`, `center` at `0`, and `max` at `+1`. The result is rounded and clamped to
 * `[min, max]`.
 */
export function axisToPulse(value: number, range: PulseRange = DEFAULT_PULSE_RANGE): number {
  const v = clamp(value, -1, 1);
  const us =
    v >= 0
      ? range.center + v * (range.max - range.center)
      : range.center + v * (range.center - range.min);
  return clamp(Math.round(us), range.min, range.max);
}

/**
 * Map a shaped axis value in `[-1, 1]` to a `MANUAL_CONTROL` field
 * (`-1000…1000`, rounded and clamped).
 */
export function axisToManual(value: number): number {
  return clamp(
    Math.round(clamp(value, -1, 1) * MANUAL_FULL_SCALE),
    -MANUAL_FULL_SCALE,
    MANUAL_FULL_SCALE,
  );
}
