/**
 * i18n registration for the Network egress-transparency section (tasks T3.7 /
 * T8.12; spec plan/07 §7.7, plan/08 §8.3, conventions plan/implementation/00
 * §0.3).
 *
 * Contributes the `settings.network.*` namespace to the English catalog via the
 * public {@link registerMessages} seam — never editing the i18n internals.
 * Registration runs once at import and is idempotent; the network barrel
 * imports this for its side effect.
 */
import { registerMessages } from '../../../../core/i18n';

/** English `settings.network.*` strings contributed by the Network section. */
export const NETWORK_MESSAGES: Readonly<Record<string, string>> = {
  // Network (egress transparency; spec plan/07 §7.7, plan/08 §8.3).
  'settings.network.label': 'Network',
  'settings.network.noPhoneHome':
    'No analytics, no telemetry, no phone-home. Every network destination below is user-configured.',
  'settings.network.map.label': 'Map tile source',
  'settings.network.map.default': 'Built-in / offline tiles only (no custom source configured).',
  'settings.network.links.label': 'Active links',
  'settings.network.links.none': 'No active network link.',
  'settings.network.links.active': 'Active MAVLink link',
  'settings.network.grants.label': 'Extension network grants',
  'settings.network.grants.none': 'No extension has been granted network access.',
  'settings.network.grants.by': 'granted to {ext}',
  'settings.network.egress.label': 'Egress log',
  'settings.network.egress.empty': 'No network egress recorded.',
  'settings.network.egress.row': '{ext} · {time}',
  'settings.network.egress.clear': 'Clear egress log',
};

let registered = false;

/** Register the `settings.network.*` English catalog once (idempotent). */
export function registerNetworkMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(NETWORK_MESSAGES);
}

registerNetworkMessages();
