/**
 * Accelerometer setup step pure derivation tests (task T5.4). Verifies the
 * six-face sequence, face normalization/progress, and setup status mapping.
 */
import { describe, expect, it } from 'vitest';
import type { SettledStatus } from '../../src/ui/screens/setup/framework';
import {
  ACCEL_FACE_SEQUENCE,
  accelFaceProgress,
  accelFlowStatusKey,
  flowsToSettledStatus,
  levelFlowStatusKey,
  normalizeAccelFace,
  type AccelFaceId,
} from '../../src/ui/screens/setup/accel';

describe('accelerometer setup derivation', () => {
  it('defines the required 6-point face order', () => {
    const ids = ACCEL_FACE_SEQUENCE.map((face) => face.id);
    expect(ids).toEqual<AccelFaceId[]>(['LEVEL', 'LEFT', 'RIGHT', 'NOSEDOWN', 'NOSEUP', 'BACK']);
  });

  it('normalizes calibration face strings', () => {
    expect(normalizeAccelFace('LEVEL')).toBe<AccelFaceId>('LEVEL');
    expect(normalizeAccelFace('nose_down')).toBe<AccelFaceId>('NOSEDOWN');
    expect(normalizeAccelFace('nose-up')).toBe<AccelFaceId>('NOSEUP');
    expect(normalizeAccelFace(' back ')).toBe<AccelFaceId>('BACK');
    expect(normalizeAccelFace('unknown')).toBeUndefined();
  });

  it('derives one-based face progress', () => {
    expect(accelFaceProgress('LEVEL')).toEqual({ current: 1, total: 6 });
    expect(accelFaceProgress('BACK')).toEqual({ current: 6, total: 6 });
  });

  it('maps accel and level flows to wizard status', () => {
    expect(flowsToSettledStatus('idle')).toBe<SettledStatus>('todo');
    expect(flowsToSettledStatus('running')).toBe<SettledStatus>('todo');
    expect(flowsToSettledStatus('done')).toBe<SettledStatus>('done');
    expect(flowsToSettledStatus('warning')).toBe<SettledStatus>('warning');
    expect(flowsToSettledStatus('done', 'running')).toBe<SettledStatus>('todo');
    expect(flowsToSettledStatus('done', 'warning')).toBe<SettledStatus>('warning');
  });

  it('derives stable i18n keys for flow states', () => {
    expect(accelFlowStatusKey('running')).toBe('setup.accel.state.running');
    expect(levelFlowStatusKey('done')).toBe('setup.accel.level.state.done');
  });
});
