/**
 * i18n registration for the Setup wizard framework (task T5.2; conventions
 * plan/implementation/00 §0.3, spec plan/05 §5.4 Setup / §5.9).
 *
 * Contributes the framework-level `setup.*` strings (shell chrome, status badge
 * labels, navigation, callout titles) to the English catalog via the public
 * {@link registerMessages} seam. The per-step modules (T5.3–T5.10) register
 * their own disjoint `setup.<step>.*` namespaces. Registration runs once at
 * import and is idempotent.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `setup.*` strings owned by the wizard framework shell. */
export const SETUP_MESSAGES: Readonly<Record<string, string>> = {
  'setup.title': 'Setup',
  'setup.steps.label': 'Setup steps',
  'setup.progress': '{done} of {total} complete',
  'setup.empty': 'No setup steps available.',
  'setup.prev': 'Back',
  'setup.next': 'Next',
  'setup.markComplete': 'Mark complete',

  // Step status badge labels (keyed by `setup.status.<status>`).
  'setup.status.todo': 'To do',
  'setup.status.active': 'In progress',
  'setup.status.done': 'Done',
  'setup.status.warning': 'Needs attention',
  'setup.status.na': 'Not applicable',

  // Safety / info callout (spec plan/05 §5.4 "what this does / safety").
  'setup.safety.title': 'Safety',
  'setup.info.title': 'What this does',
};

let registered = false;

/** Register the framework's `setup.*` English catalog once (idempotent). */
export function registerSetupMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(SETUP_MESSAGES);
}

registerSetupMessages();
