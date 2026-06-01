/**
 * Setup wizard framework — pure status/derivation + navigation tests (task
 * T5.2; spec plan/04 §4.4, plan/05 §5.4). No Solid, no DOM: these exercise the
 * total functions the {@link WizardShell} is built on.
 */
import { describe, it, expect } from 'vitest';
import {
  clampIndex,
  isComplete,
  navTargetId,
  nextStepId,
  prevStepId,
  resolveInitialStepId,
  resolveSettledStatus,
  statusMessageKey,
  stepIndex,
  summarizeCompletion,
  toDisplayStatus,
  type SetupStep,
  type SettledStatus,
} from '../../src/ui/screens/setup/framework';

/** A minimal step stub (render returns nothing — irrelevant to pure logic). */
function makeStep(id: string, status?: () => SettledStatus): SetupStep {
  return {
    id,
    title: id.toUpperCase(),
    ...(status !== undefined ? { status } : {}),
    render: (): null => null,
  };
}

const STEPS: readonly SetupStep[] = [makeStep('frame'), makeStep('accel'), makeStep('compass')];

describe('resolveSettledStatus', () => {
  it('defaults to todo with no override and no accessor', () => {
    expect(resolveSettledStatus(makeStep('a'), new Map())).toBe('todo');
  });

  it('uses the derived accessor when present', () => {
    expect(
      resolveSettledStatus(
        makeStep('a', () => 'done'),
        new Map(),
      ),
    ).toBe('done');
  });

  it('lets an explicit override win over the accessor', () => {
    const step = makeStep('a', () => 'todo');
    const overrides = new Map<string, SettledStatus>([['a', 'warning']]);
    expect(resolveSettledStatus(step, overrides)).toBe('warning');
  });
});

describe('toDisplayStatus', () => {
  it('shows active only for an active, still-todo step', () => {
    expect(toDisplayStatus('todo', true)).toBe('active');
    expect(toDisplayStatus('todo', false)).toBe('todo');
  });

  it('keeps a settled badge even when active', () => {
    expect(toDisplayStatus('done', true)).toBe('done');
    expect(toDisplayStatus('warning', true)).toBe('warning');
    expect(toDisplayStatus('na', true)).toBe('na');
  });
});

describe('isComplete', () => {
  it('counts done and na, not todo/warning', () => {
    expect(isComplete('done')).toBe(true);
    expect(isComplete('na')).toBe(true);
    expect(isComplete('todo')).toBe(false);
    expect(isComplete('warning')).toBe(false);
  });
});

describe('summarizeCompletion', () => {
  it('aggregates completion across the registry', () => {
    const resolved: Record<string, SettledStatus> = {
      frame: 'done',
      accel: 'na',
      compass: 'warning',
    };
    const summary = summarizeCompletion(STEPS, (s) => resolved[s.id] ?? 'todo');
    expect(summary).toEqual({ total: 3, complete: 2, allComplete: false });
  });

  it('reports allComplete only when every step is satisfied', () => {
    const all = summarizeCompletion(STEPS, () => 'done');
    expect(all).toEqual({ total: 3, complete: 3, allComplete: true });
    expect(summarizeCompletion([], () => 'done').allComplete).toBe(false);
  });
});

describe('statusMessageKey', () => {
  it('namespaces the badge key', () => {
    expect(statusMessageKey('active')).toBe('setup.status.active');
    expect(statusMessageKey('na')).toBe('setup.status.na');
  });
});

describe('navigation', () => {
  it('finds and clamps indices', () => {
    expect(stepIndex(STEPS, 'accel')).toBe(1);
    expect(stepIndex(STEPS, 'missing')).toBe(-1);
    expect(stepIndex(STEPS, undefined)).toBe(-1);
    expect(clampIndex(STEPS, 9)).toBe(2);
    expect(clampIndex(STEPS, -3)).toBe(0);
    expect(clampIndex([], 0)).toBe(-1);
  });

  it('walks next/prev and stops at the ends', () => {
    expect(nextStepId(STEPS, 'frame')).toBe('accel');
    expect(nextStepId(STEPS, 'compass')).toBeUndefined();
    expect(nextStepId(STEPS, undefined)).toBe('frame');
    expect(prevStepId(STEPS, 'accel')).toBe('frame');
    expect(prevStepId(STEPS, 'frame')).toBeUndefined();
  });

  it('resolves the initial step id', () => {
    expect(resolveInitialStepId(STEPS, 'compass')).toBe('compass');
    expect(resolveInitialStepId(STEPS, 'missing')).toBe('frame');
    expect(resolveInitialStepId(STEPS, undefined)).toBe('frame');
    expect(resolveInitialStepId([], undefined)).toBeUndefined();
  });

  it('clamps keyboard navigation at the ends', () => {
    expect(navTargetId(STEPS, 'frame', 'next')).toBe('accel');
    expect(navTargetId(STEPS, 'compass', 'next')).toBe('compass');
    expect(navTargetId(STEPS, 'frame', 'prev')).toBe('frame');
    expect(navTargetId(STEPS, 'accel', 'first')).toBe('frame');
    expect(navTargetId(STEPS, 'accel', 'last')).toBe('compass');
  });
});
