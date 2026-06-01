/**
 * i18n registration for the Setup screen assembly (task T5.12; spec plan/05
 * §5.4 Setup / §5.9). Contributes the screen-level `setup.params.*` strings used
 * by the parameter-fetch affordance the assembly adds above the wizard. The
 * framework (`setup.*`) and each per-step module (`setup.<step>.*`) own their own
 * disjoint namespaces; this file only adds the `setup.params.*` keys.
 *
 * Registration runs once at import and is idempotent.
 */
import { registerMessages } from '../../../core/i18n';

/** English `setup.params.*` strings owned by the Setup screen assembly. */
export const SETUP_SCREEN_MESSAGES: Readonly<Record<string, string>> = {
  'setup.params.fetch': 'Fetch parameters',
  'setup.params.refresh': 'Refresh parameters',
  'setup.params.fetching': 'Fetching parameters…',
  'setup.params.progress': 'Fetching parameters {done}/{total}…',
  'setup.params.error': 'Parameter fetch failed: {error}',
};

let registered = false;

/** Register the Setup screen's `setup.params.*` English catalog once (idempotent). */
export function registerSetupScreenMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(SETUP_SCREEN_MESSAGES);
}

registerSetupScreenMessages();
