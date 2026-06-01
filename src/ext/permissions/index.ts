/**
 * `ext/permissions` public surface — the extension permission model + broker
 * (task T7.2; spec plan/06 §6.5, plan/08 §8.3).
 *
 * Three pieces sit behind the T7.1 seams so T7.3 can register the concrete
 * `ExtContext` methods:
 *  - {@link createGrantStore} — persisted per-extension granted scopes.
 *  - {@link requestGrants} — the install-prompt flow (UI-injected `prompt`).
 *  - {@link PermissionBroker} — `registerApi` + `invoke` mediation (permission
 *    checks, armed-aware confirm, audit, egress gating) and `capabilitiesFor`.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). See `./README.md`.
 */
export { ExtPermissionError, toErrorMessage } from './errors';
export type { ExtPermissionDenial } from './errors';
export {
  HIGH_RISK_PERMISSIONS,
  VEHICLE_AFFECTING_PERMISSIONS,
  isHighRiskPermission,
  isVehicleAffectingPermission,
  auditKindForPermission,
} from './risk';
export { createGrantStore, GRANTS_NAMESPACE } from './grant-store';
export type { GrantStore } from './grant-store';
export { requestGrants, describePermissionRequests } from './prompt';
export type { GrantPrompt, PermissionRequest } from './prompt';
export { PermissionBroker, createPermissionBroker } from './broker';
export type {
  ApiHandler,
  ConfirmFn,
  EgressRecord,
  RegisterOptions,
  PermissionBrokerDeps,
} from './broker';
