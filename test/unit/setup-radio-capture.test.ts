/**
 * Radio setup pure capture tests (T5.6). Exercises min/max/trim accumulation
 * without Solid or MAVLink so the save mapping is deterministic.
 */
import { describe, expect, it } from 'vitest';
import {
  EMPTY_RADIO_CAPTURE,
  accumulateRadioChannels,
  radioBarPercent,
  radioParamWrites,
  type RadioCaptureState,
  type RadioChannelCapture,
} from '../../src/ui/screens/setup/radio';

function channel(state: RadioCaptureState, index: number): RadioChannelCapture {
  const found = state.channels.find((entry) => entry.index === index);
  if (found === undefined) throw new Error(`missing channel ${index}`);
  return found;
}

describe('radio capture accumulation', () => {
  it('captures per-channel min/max and uses the latest resting value as trim', () => {
    let state = accumulateRadioChannels(EMPTY_RADIO_CAPTURE, [1500, 1500, 1000]);
    state = accumulateRadioChannels(state, [1000, 2000, 1100]);
    state = accumulateRadioChannels(state, [2000, 1200, 1900]);
    state = accumulateRadioChannels(state, [1505, 1495, 1500]);

    expect(channel(state, 1)).toMatchObject({
      index: 1,
      current: 1505,
      min: 1000,
      max: 2000,
      trim: 1505,
      sampleCount: 4,
    });
    expect(channel(state, 2)).toMatchObject({
      index: 2,
      current: 1495,
      min: 1200,
      max: 2000,
      trim: 1495,
      sampleCount: 4,
    });
    expect(channel(state, 3)).toMatchObject({ min: 1000, max: 1900, trim: 1500 });
  });

  it('builds RCn_MIN/MAX/TRIM writes for active channels only', () => {
    const state = accumulateRadioChannels(
      accumulateRadioChannels(EMPTY_RADIO_CAPTURE, [1500, 1500]),
      [1000, 2000],
    );

    expect(radioParamWrites(state.channels)).toEqual([
      { name: 'RC1_MIN', value: 1000 },
      { name: 'RC1_MAX', value: 1500 },
      { name: 'RC1_TRIM', value: 1000 },
      { name: 'RC2_MIN', value: 1500 },
      { name: 'RC2_MAX', value: 2000 },
      { name: 'RC2_TRIM', value: 2000 },
    ]);
  });

  it('clamps display bar percentages to the expected RC display range', () => {
    expect(radioBarPercent(800)).toBe(0);
    expect(radioBarPercent(1500)).toBe(50);
    expect(radioBarPercent(2200)).toBe(100);
    expect(radioBarPercent(500)).toBe(0);
    expect(radioBarPercent(2500)).toBe(100);
  });
});
