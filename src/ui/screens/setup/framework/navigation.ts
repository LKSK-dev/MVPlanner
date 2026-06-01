/**
 * Pure navigation helpers for the Setup wizard framework (task T5.2). Total
 * functions over the ordered step registry; no Solid, no DOM.
 *
 * Two distinct behaviours intentionally differ:
 *  - {@link nextStepId} / {@link prevStepId} return `undefined` past the ends
 *    (used to DISABLE the footer Back/Next buttons); whereas
 *  - {@link navTargetId} CLAMPS at the ends (used for roving keyboard nav, which
 *    should never lose focus off the list).
 */
import type { SetupStep } from './types';

/** Index of the step with `id`, or `-1` when absent / `id` is `undefined`. */
export function stepIndex(steps: readonly SetupStep[], id: string | undefined): number {
  if (id === undefined) return -1;
  return steps.findIndex((s) => s.id === id);
}

/** Clamp `index` into `[0, steps.length - 1]`, or `-1` when there are no steps. */
export function clampIndex(steps: readonly SetupStep[], index: number): number {
  if (steps.length === 0) return -1;
  if (index < 0) return 0;
  if (index > steps.length - 1) return steps.length - 1;
  return index;
}

/** The next step id after `activeId`, or `undefined` at/after the last step. */
export function nextStepId(
  steps: readonly SetupStep[],
  activeId: string | undefined,
): string | undefined {
  const i = stepIndex(steps, activeId);
  if (i < 0) return steps[0]?.id;
  return steps[i + 1]?.id;
}

/** The previous step id before `activeId`, or `undefined` at the first step. */
export function prevStepId(
  steps: readonly SetupStep[],
  activeId: string | undefined,
): string | undefined {
  const i = stepIndex(steps, activeId);
  if (i <= 0) return undefined;
  return steps[i - 1]?.id;
}

/**
 * Resolve the initial active step id: the `requested` id when it exists in the
 * registry, otherwise the first step (or `undefined` for an empty registry).
 */
export function resolveInitialStepId(
  steps: readonly SetupStep[],
  requested: string | undefined,
): string | undefined {
  if (requested !== undefined && steps.some((s) => s.id === requested)) return requested;
  return steps[0]?.id;
}

/** A roving-keyboard navigation intent. */
export type StepNavKey = 'next' | 'prev' | 'first' | 'last';

/**
 * The target step id for a clamped keyboard navigation from `activeId`. Unlike
 * {@link nextStepId} / {@link prevStepId} this never steps off the ends, so the
 * tablist keeps a focusable tab.
 */
export function navTargetId(
  steps: readonly SetupStep[],
  activeId: string | undefined,
  key: StepNavKey,
): string | undefined {
  switch (key) {
    case 'first':
      return steps[0]?.id;
    case 'last':
      return steps[steps.length - 1]?.id;
    case 'next':
      return steps[clampIndex(steps, stepIndex(steps, activeId) + 1)]?.id;
    case 'prev':
      return steps[clampIndex(steps, stepIndex(steps, activeId) - 1)]?.id;
  }
}
