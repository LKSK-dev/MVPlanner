/**
 * Pure step-status derivation helpers for the Setup wizard framework (task
 * T5.2). No Solid, no DOM — just total functions over a step registry so the
 * completion logic is trivially unit-testable (test/unit/setup-framework-*).
 */
import type { SetupStep, SettledStatus, StepStatus } from './types';

/** The default settled status for a step with no override and no accessor. */
export const DEFAULT_SETTLED_STATUS: SettledStatus = 'todo';

/**
 * Resolve a step's settled status with a fixed precedence:
 * explicit override → derived `status` accessor → `'todo'`.
 *
 * @param step - The step to resolve.
 * @param overrides - Map of explicit step-id → status (from "mark complete").
 */
export function resolveSettledStatus(
  step: SetupStep,
  overrides: ReadonlyMap<string, SettledStatus>,
): SettledStatus {
  const override = overrides.get(step.id);
  if (override !== undefined) return override;
  return step.status?.() ?? DEFAULT_SETTLED_STATUS;
}

/**
 * Map a settled status + active flag to the display status: the active step is
 * shown as `'active'` only while it is still `'todo'`, so a finished step keeps
 * its `'done'` / `'warning'` / `'na'` badge even when selected.
 */
export function toDisplayStatus(settled: SettledStatus, isActive: boolean): StepStatus {
  if (isActive && settled === 'todo') return 'active';
  return settled;
}

/**
 * A settled status counts as complete when it is `'done'` or `'na'` (not
 * applicable). `'warning'` is intentionally NOT complete — it still needs
 * attention.
 */
export function isComplete(settled: SettledStatus): boolean {
  return settled === 'done' || settled === 'na';
}

/** Aggregate completion across a step registry. */
export interface CompletionSummary {
  /** Total number of steps. */
  readonly total: number;
  /** Number of steps whose status {@link isComplete}. */
  readonly complete: number;
  /** True when there is at least one step and every step is complete. */
  readonly allComplete: boolean;
}

/**
 * Summarize completion over `steps`, resolving each step's status via `resolve`
 * (typically a closure over the current overrides map / Solid signals).
 */
export function summarizeCompletion(
  steps: readonly SetupStep[],
  resolve: (step: SetupStep) => SettledStatus,
): CompletionSummary {
  let complete = 0;
  for (const step of steps) {
    if (isComplete(resolve(step))) complete += 1;
  }
  return {
    total: steps.length,
    complete,
    allComplete: steps.length > 0 && complete === steps.length,
  };
}

/** The i18n key for a status badge label, e.g. `'setup.status.done'`. */
export function statusMessageKey(status: StepStatus): string {
  return `setup.status.${status}`;
}
