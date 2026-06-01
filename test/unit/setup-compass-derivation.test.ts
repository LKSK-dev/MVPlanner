/**
 * Compass calibration step — pure derivation tests (task T5.5; spec plan/04
 * §4.4 compass). No Solid, no DOM: exercises the total progress/fitness/result-
 * state helpers the step's flow is built on.
 */
import { describe, it, expect } from 'vitest';
import {
  clampPct,
  deriveResultState,
  flowStatusKey,
  flowToSettledStatus,
  isPoorFitness,
  DEFAULT_POOR_FITNESS_MGAUSS,
} from '../../src/ui/screens/setup/compass';

describe('clampPct', () => {
  it('clamps into 0..100 and coerces non-finite to 0', () => {
    expect(clampPct(-5)).toBe(0);
    expect(clampPct(0)).toBe(0);
    expect(clampPct(42.5)).toBe(42.5);
    expect(clampPct(100)).toBe(100);
    expect(clampPct(150)).toBe(100);
    expect(clampPct(Number.NaN)).toBe(0);
    // Non-finite inputs coerce to the safe 0 default.
    expect(clampPct(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('isPoorFitness', () => {
  it('treats an absent or non-finite reading as not poor', () => {
    expect(isPoorFitness(undefined)).toBe(false);
    expect(isPoorFitness(Number.NaN)).toBe(false);
  });

  it('flags readings worse than the threshold', () => {
    expect(isPoorFitness(DEFAULT_POOR_FITNESS_MGAUSS)).toBe(false);
    expect(isPoorFitness(DEFAULT_POOR_FITNESS_MGAUSS + 0.1)).toBe(true);
    expect(isPoorFitness(5, 4)).toBe(true);
    expect(isPoorFitness(5, 10)).toBe(false);
  });
});

describe('deriveResultState', () => {
  it('maps a rejection to warning regardless of fitness', () => {
    expect(deriveResultState({ kind: 'error' })).toBe('warning');
    expect(deriveResultState({ kind: 'error', fitness: 1 })).toBe('warning');
  });

  it('maps a good-fit success to done', () => {
    expect(deriveResultState({ kind: 'success', offsets: [1, 2, 3] })).toBe('done');
    expect(deriveResultState({ kind: 'success', offsets: [1, 2, 3], fitness: 4 })).toBe('done');
  });

  it('maps a poor-fit success to warning', () => {
    expect(deriveResultState({ kind: 'success', offsets: [1, 2, 3], fitness: 99 })).toBe('warning');
    expect(deriveResultState({ kind: 'success', fitness: 6 }, 5)).toBe('warning');
  });
});

describe('flowToSettledStatus', () => {
  it('reports todo while idle/running so the shell can show the active badge', () => {
    expect(flowToSettledStatus('idle')).toBe('todo');
    expect(flowToSettledStatus('running')).toBe('todo');
  });

  it('passes through the terminal statuses', () => {
    expect(flowToSettledStatus('done')).toBe('done');
    expect(flowToSettledStatus('warning')).toBe('warning');
  });
});

describe('flowStatusKey', () => {
  it('namespaces the flow state', () => {
    expect(flowStatusKey('running')).toBe('setup.compass.state.running');
    expect(flowStatusKey('done')).toBe('setup.compass.state.done');
  });
});
