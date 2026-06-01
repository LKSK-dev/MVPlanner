/**
 * `ui/screens/setup/framework` public surface (task T5.2; spec plan/04 §4.4,
 * plan/05 §5.4 Setup). The reusable Setup WIZARD FRAMEWORK: a {@link WizardShell}
 * (left step list + right guided pane), a {@link SafetyCallout} banner, the
 * {@link SetupStep} contract the per-step UIs (T5.3–T5.10) implement, plus the
 * pure status-derivation + navigation helpers.
 *
 * Cross-module consumers (the per-step modules + the Setup screen assembly
 * T5.12) import from here, never deep paths (conventions plan/implementation/00
 * §0.3). The `setup.*` framework strings are registered as a side effect of
 * importing {@link WizardShell} (and re-exported via {@link registerSetupMessages}).
 *
 * @see ./README.md for how T5.3–T5.10 register steps and how to test.
 */
export { WizardShell, type WizardShellProps } from './wizard-shell';
export { SafetyCallout, type SafetyCalloutProps, type SafetyCalloutKind } from './safety-callout';
export { registerSetupMessages, SETUP_MESSAGES } from './messages';

export type { SetupStep, SetupStepApi, SettledStatus, StepStatus, TFn } from './types';

export {
  DEFAULT_SETTLED_STATUS,
  resolveSettledStatus,
  toDisplayStatus,
  isComplete,
  summarizeCompletion,
  statusMessageKey,
  type CompletionSummary,
} from './status';

export {
  stepIndex,
  clampIndex,
  nextStepId,
  prevStepId,
  resolveInitialStepId,
  navTargetId,
  type StepNavKey,
} from './navigation';
