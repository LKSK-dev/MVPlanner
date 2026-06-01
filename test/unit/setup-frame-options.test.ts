/**
 * Frame setup pure tests: option tables and current-parameter derivation.
 */
import { describe, expect, it } from 'vitest';
import {
  COPTER_FRAME_CLASS_OPTIONS,
  COPTER_FRAME_TYPE_OPTIONS,
  deriveFrameSelection,
  findFrameOption,
  hasValidFrameClass,
  type FrameParamName,
} from '../../src/ui/screens/setup/frame';

function reader(values: Partial<Record<FrameParamName, number>>) {
  return (name: FrameParamName): number | undefined => values[name];
}

describe('copter frame option tables', () => {
  it('contains the approved FRAME_CLASS mapping', () => {
    expect(COPTER_FRAME_CLASS_OPTIONS.map((option) => option.value)).toEqual([
      1, 2, 3, 4, 5, 7, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
    expect(findFrameOption(COPTER_FRAME_CLASS_OPTIONS, 1)?.labelKey).toBe(
      'setup.frame.copter.class.quad',
    );
    expect(findFrameOption(COPTER_FRAME_CLASS_OPTIONS, 17)?.labelKey).toBe(
      'setup.frame.copter.class.heliQuad17',
    );
  });

  it('contains the approved FRAME_TYPE mapping', () => {
    expect(COPTER_FRAME_TYPE_OPTIONS.map((option) => option.value)).toEqual([
      0, 1, 2, 3, 4, 5, 10, 11, 12, 13, 14,
    ]);
    expect(findFrameOption(COPTER_FRAME_TYPE_OPTIONS, 1)?.labelKey).toBe(
      'setup.frame.copter.type.x',
    );
    expect(findFrameOption(COPTER_FRAME_TYPE_OPTIONS, 14)?.labelKey).toBe(
      'setup.frame.copter.type.clockwiseX',
    );
  });
});

describe('deriveFrameSelection', () => {
  it('derives a valid copter selection from current params', () => {
    const selection = deriveFrameSelection('copter', reader({ FRAME_CLASS: 1, FRAME_TYPE: 12 }));

    expect(selection.mode).toBe('selectable');
    expect(selection.validFrameClass).toBe(true);
    expect(selection.frameClass?.name).toBe('FRAME_CLASS');
    expect(selection.frameClass?.option?.labelKey).toBe('setup.frame.copter.class.quad');
    expect(selection.frameType?.name).toBe('FRAME_TYPE');
    expect(selection.frameType?.option?.labelKey).toBe('setup.frame.copter.type.betaFlightX');
  });

  it('marks an unknown copter frame class invalid', () => {
    const selection = deriveFrameSelection('copter', reader({ FRAME_CLASS: 99, FRAME_TYPE: 1 }));

    expect(selection.validFrameClass).toBe(false);
    expect(selection.frameClass?.value).toBe(99);
    expect(selection.frameClass?.option).toBeUndefined();
    expect(hasValidFrameClass(selection.frameClass)).toBe(false);
  });

  it('uses parameter-only definitions for non-copter vehicles without inventing labels', () => {
    const plane = deriveFrameSelection('plane', reader({ Q_FRAME_CLASS: 3, Q_FRAME_TYPE: 1 }));
    const rover = deriveFrameSelection('rover', reader({ FRAME_CLASS: 2 }));
    const sub = deriveFrameSelection('sub', reader({ FRAME_CONFIG: 0 }));

    expect(plane.mode).toBe('parameters');
    expect(plane.params.map((param) => param.name)).toEqual(['Q_FRAME_CLASS', 'Q_FRAME_TYPE']);
    expect(plane.frameClass?.options).toEqual([]);
    expect(plane.validFrameClass).toBe(true);

    expect(rover.params.map((param) => param.name)).toEqual(['FRAME_CLASS']);
    expect(rover.validFrameClass).toBe(true);

    expect(sub.params.map((param) => param.name)).toEqual(['FRAME_CONFIG']);
    expect(sub.validFrameClass).toBe(false);
  });

  it('degrades unknown classes to an unsupported note with todo status', () => {
    const selection = deriveFrameSelection('unknown', reader({}));

    expect(selection.mode).toBe('unsupported');
    expect(selection.params).toEqual([]);
    expect(selection.validFrameClass).toBe(false);
  });
});
