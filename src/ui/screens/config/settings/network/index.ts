/**
 * Settings → Network public surface (task T8.12; spec plan/07 §7.7, plan/08
 * §8.3). The egress-transparency section + its egress log sink. Imported by the
 * Settings screen barrel; cross-module consumers import from here.
 */
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
