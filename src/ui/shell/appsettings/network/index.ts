/**
 * App Settings → Network public surface (task T8.12; spec plan/07 §7.7,
 * plan/08 §8.3). The egress-transparency section + its egress log sink,
 * rendered by the App Settings pane's General section. Cross-module consumers
 * import from here (or the `ui/shell/appsettings` barrel), never deep paths
 * (conventions plan/implementation/00 §0.3). Importing this module registers
 * the `settings.network.*` i18n strings as a side effect.
 */
import './messages';

export {
  NetworkSection,
  type NetworkSectionProps,
  type NetworkSectionDeps,
  type LinkDestination,
  type NetGrantRow,
} from './network-section';
export {
  createEgressLog,
  DEFAULT_EGRESS_MAX,
  type EgressLog,
  type EgressEntry,
  type EgressLogOptions,
} from './egress-log';
export { NETWORK_MESSAGES, registerNetworkMessages } from './messages';
