/**
 * Pure axis→channel transform tests for the manual-control microservice
 * (task T8.6; spec plan/04 §4.2 joystick).
 *
 * Exercises the shaping pipeline (deadzone → expo → reverse → trim) and the
 * RC-pulse / MANUAL_CONTROL encoders + the ignore-sentinel predicate, with no
 * Gamepad API, Worker, or clock.
 */
import { describe, it, expect } from 'vitest';
import {
  axisToManual,
  axisToPulse,
  isIgnoredPulse,
  NEUTRAL_SHAPE,
  shapeAxis,
  type AxisShape,
} from '../../src/mavlink/microservices/manual';

const shape = (p: Partial<AxisShape> = {}): AxisShape => ({ ...NEUTRAL_SHAPE, ...p });

describe('shapeAxis', () => {
  it('is the identity (clamped) with a neutral shape', () => {
    expect(shapeAxis(0, shape())).toBe(0);
    expect(shapeAxis(0.5, shape())).toBeCloseTo(0.5, 10);
    expect(shapeAxis(-0.5, shape())).toBeCloseTo(-0.5, 10);
    // out-of-range input is clamped to [-1, 1]
    expect(shapeAxis(2, shape())).toBe(1);
    expect(shapeAxis(-9, shape())).toBe(-1);
  });

  it('deadzone zeroes the centre band and rescales the live band', () => {
    const s = shape({ deadzone: 0.2 });
    expect(shapeAxis(0.1, s)).toBe(0); // inside deadzone → 0
    expect(shapeAxis(0.2, s)).toBe(0); // edge → 0
    // 0.6 with dz 0.2 → (0.6-0.2)/(1-0.2) = 0.5
    expect(shapeAxis(0.6, s)).toBeCloseTo(0.5, 10);
    expect(shapeAxis(1, s)).toBeCloseTo(1, 10); // extreme still reaches 1
    expect(shapeAxis(-0.6, s)).toBeCloseTo(-0.5, 10); // sign preserved
  });

  it('deadzone of 1 zeroes everything', () => {
    const s = shape({ deadzone: 1 });
    expect(shapeAxis(1, s)).toBe(0);
    expect(shapeAxis(-1, s)).toBe(0);
  });

  it('expo softens centre response but preserves the extremes', () => {
    const s = shape({ expo: 1 }); // full cubic
    // expo=1 → v^3
    expect(shapeAxis(0.5, s)).toBeCloseTo(0.125, 10);
    expect(shapeAxis(1, s)).toBeCloseTo(1, 10);
    expect(shapeAxis(-1, s)).toBeCloseTo(-1, 10);
    // partial expo blends linear + cubic: 0.5 → 0.5*0.5 + 0.5*0.125 = 0.3125
    expect(shapeAxis(0.5, shape({ expo: 0.5 }))).toBeCloseTo(0.3125, 10);
  });

  it('reverse negates the shaped value', () => {
    expect(shapeAxis(0.5, shape({ reverse: true }))).toBeCloseTo(-0.5, 10);
    expect(shapeAxis(-1, shape({ reverse: true }))).toBeCloseTo(1, 10);
  });

  it('trim offsets after shaping and re-clamps', () => {
    expect(shapeAxis(0, shape({ trim: 0.1 }))).toBeCloseTo(0.1, 10);
    expect(shapeAxis(0.95, shape({ trim: 0.2 }))).toBe(1); // re-clamped
  });

  it('applies the pipeline in order: deadzone → expo → reverse → trim', () => {
    // raw 0.6, dz 0.2 → 0.5; expo 1 → 0.125; reverse → -0.125; trim 0.1 → -0.025
    const s = shape({ deadzone: 0.2, expo: 1, reverse: true, trim: 0.1 });
    expect(shapeAxis(0.6, s)).toBeCloseTo(-0.025, 10);
  });
});

describe('axisToPulse', () => {
  it('maps -1/0/+1 to min/center/max with the default 1000/1500/2000 range', () => {
    expect(axisToPulse(-1)).toBe(1000);
    expect(axisToPulse(0)).toBe(1500);
    expect(axisToPulse(1)).toBe(2000);
    expect(axisToPulse(0.5)).toBe(1750);
    expect(axisToPulse(-0.5)).toBe(1250);
  });

  it('honours an asymmetric custom range piecewise', () => {
    const range = { min: 1100, center: 1600, max: 1900 };
    expect(axisToPulse(-1, range)).toBe(1100);
    expect(axisToPulse(0, range)).toBe(1600);
    expect(axisToPulse(1, range)).toBe(1900);
    // +0.5 → 1600 + 0.5*(1900-1600) = 1750
    expect(axisToPulse(0.5, range)).toBe(1750);
    // -0.5 → 1600 + (-0.5)*(1600-1100) = 1350
    expect(axisToPulse(-0.5, range)).toBe(1350);
  });

  it('rounds and clamps to the range bounds', () => {
    expect(axisToPulse(2)).toBe(2000);
    expect(axisToPulse(-2)).toBe(1000);
  });
});

describe('axisToManual', () => {
  it('maps -1/0/+1 to -1000/0/1000 (rounded, clamped)', () => {
    expect(axisToManual(-1)).toBe(-1000);
    expect(axisToManual(0)).toBe(0);
    expect(axisToManual(1)).toBe(1000);
    expect(axisToManual(0.5)).toBe(500);
    expect(axisToManual(2)).toBe(1000);
    expect(axisToManual(-2)).toBe(-1000);
  });
});

describe('isIgnoredPulse', () => {
  it('treats 0 and 65535 as release/ignore sentinels', () => {
    expect(isIgnoredPulse(0)).toBe(true);
    expect(isIgnoredPulse(65535)).toBe(true);
    expect(isIgnoredPulse(1500)).toBe(false);
    expect(isIgnoredPulse(1000)).toBe(false);
  });
});
