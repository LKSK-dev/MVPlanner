/**
 * Vehicle-aware tuning-group selection (task T3.6; spec plan/04 §4.5 tuning).
 *
 * Pure, DOM-free coverage of {@link tuningGroupsForClass} — in particular that
 * ArduPlane surfaces both the fixed-wing rate controllers AND the QuadPlane
 * VTOL attitude/rate (`Q_A_*`) controllers so VTOL tuning is reachable.
 */
import { describe, expect, it } from 'vitest';
import {
  groupParamNames,
  tuningGroupsForClass,
  type TuningGroup,
} from '../../src/ui/screens/config/tuning';

function groupById(groups: readonly TuningGroup[], id: string): TuningGroup | undefined {
  return groups.find((g) => g.id === id);
}

describe('tuningGroupsForClass — plane / QuadPlane', () => {
  const plane = tuningGroupsForClass('plane');

  it('keeps the fixed-wing rate controllers as the first group', () => {
    const rate = groupById(plane, 'rate');
    expect(rate).toBeDefined();
    expect(rate?.params).toContain('RLL_RATE_P');
    expect(rate?.params).toContain('PTCH_RATE_FF');
  });

  it('adds the QuadPlane VTOL rate controllers (Q_A_RAT_*)', () => {
    const vtolRate = groupById(plane, 'vtolRate');
    expect(vtolRate).toBeDefined();
    expect(vtolRate?.params).toEqual([
      'Q_A_RAT_RLL_P',
      'Q_A_RAT_RLL_I',
      'Q_A_RAT_RLL_D',
      'Q_A_RAT_PIT_P',
      'Q_A_RAT_PIT_I',
      'Q_A_RAT_PIT_D',
      'Q_A_RAT_YAW_P',
      'Q_A_RAT_YAW_I',
      'Q_A_RAT_YAW_D',
    ]);
  });

  it('adds the QuadPlane VTOL angle controllers (Q_A_ANG_*)', () => {
    const vtolAngle = groupById(plane, 'vtolAngle');
    expect(vtolAngle?.params).toEqual(['Q_A_ANG_RLL_P', 'Q_A_ANG_PIT_P', 'Q_A_ANG_YAW_P']);
  });

  it('flattens fixed-wing + VTOL params with no duplicates', () => {
    const names = groupParamNames(plane);
    expect(names).toContain('YAW_RATE_P');
    expect(names).toContain('Q_A_RAT_YAW_D');
    expect(names).toContain('Q_A_ANG_YAW_P');
    expect(new Set(names).size).toBe(names.length);
  });
});
