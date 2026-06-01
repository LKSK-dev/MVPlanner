/**
 * i18n registration for the Config screen assembly (M3 keystone; conventions
 * plan/implementation/00 §0.3, spec plan/05 §5.4 Config / §5.9).
 *
 * Contributes the tabbed Config shell's `config.*` strings to the English
 * catalog via the public {@link registerMessages} seam. The composed sub-panels
 * (parameters / tuning / settings) register their own disjoint namespaces.
 * Registration runs once at import and is idempotent.
 */
import { registerMessages } from '../../../core/i18n';

/** English `config.*` strings owned by the Config screen shell. */
export const CONFIG_MESSAGES: Readonly<Record<string, string>> = {
  'config.title': 'Configuration',
  'config.tabs.label': 'Configuration sections',
  'config.tab.params': 'Parameters',
  'config.tab.tuning': 'Tuning',
  'config.tab.settings': 'Settings',
};

let registered = false;

/** Register the Config shell's `config.*` English catalog once (idempotent). */
export function registerConfigMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(CONFIG_MESSAGES);
}

registerConfigMessages();
