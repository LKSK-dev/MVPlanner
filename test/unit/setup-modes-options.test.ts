/**
 * Flight modes setup pure-logic tests: vehicle-aware mode options from
 * `mode-maps` and current FLTMODE parameter mapping derivation.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveFlightModeMapping,
  modeOptionsForClass,
  setSimpleModeEnabled,
  simpleModeEnabled,
  type ModesParamName,
} from '../../src/ui/screens/setup/modes';

function reader(values: Partial<Record<ModesParamName, number>>) {
  return (name: ModesParamName): number | undefined => values[name];
}

describe('modeOptionsForClass', () => {
  it('returns sorted ArduPilot mode options for copter', () => {
    const options = modeOptionsForClass('copter');

    expect(options[0]).toEqual({ value: 0, name: 'STABILIZE' });
    expect(options.some((option) => option.value === 5 && option.name === 'LOITER')).toBe(true);
    expect(options.some((option) => option.value === 6 && option.name === 'RTL')).toBe(true);
    expect(options.map((option) => option.value)).toEqual(
      [...options.map((option) => option.value)].sort((a, b) => a - b),
    );
  });

  it('returns an empty list for unknown vehicle classes', () => {
    expect(modeOptionsForClass('unknown')).toEqual([]);
  });
});

describe('deriveFlightModeMapping', () => {
  it('derives channel, six positions, matched options and done status', () => {
    const mapping = deriveFlightModeMapping(
      'copter',
      reader({ FLTMODE_CH: 5, FLTMODE1: 0, FLTMODE2: 5, FLTMODE6: 6 }),
    );

    expect(mapping.channel).toEqual({
      name: 'FLTMODE_CH',
      value: 5,
      displayValue: 5,
      configured: true,
    });
    expect(mapping.positions).toHaveLength(6);
    expect(mapping.positions[0]).toMatchObject({
      position: 1,
      name: 'FLTMODE1',
      value: 0,
      option: { value: 0, name: 'STABILIZE' },
    });
    expect(mapping.positions[1]?.option).toEqual({ value: 5, name: 'LOITER' });
    expect(mapping.positions[5]?.option).toEqual({ value: 6, name: 'RTL' });
    expect(mapping.configuredModeCount).toBe(3);
    expect(mapping.status).toBe('done');
  });

  it('defaults displayed FLTMODE_CH to 5 but stays todo until the param is present', () => {
    const mapping = deriveFlightModeMapping('copter', reader({ FLTMODE1: 0 }));

    expect(mapping.channel.value).toBeUndefined();
    expect(mapping.channel.displayValue).toBe(5);
    expect(mapping.channel.configured).toBe(false);
    expect(mapping.status).toBe('todo');
  });

  it('derives optional simple and super-simple bitmasks when present', () => {
    const mapping = deriveFlightModeMapping(
      'copter',
      reader({ FLTMODE_CH: 5, FLTMODE1: 0, SIMPLE: 1, SUPER_SIMPLE: 2 }),
    );

    expect(mapping.simple).toEqual({ name: 'SIMPLE', value: 1 });
    expect(mapping.superSimple).toEqual({ name: 'SUPER_SIMPLE', value: 2 });
    expect(simpleModeEnabled(mapping.simple?.value ?? 0, 1)).toBe(true);
    expect(simpleModeEnabled(mapping.superSimple?.value ?? 0, 2)).toBe(true);
    expect(setSimpleModeEnabled(1, 1, false)).toBe(0);
    expect(setSimpleModeEnabled(0, 3, true)).toBe(4);
  });
});
