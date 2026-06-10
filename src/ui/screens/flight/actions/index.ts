/**
 * `ui/screens/flight/actions` public surface (task T2.7; spec plan/04 §4.2
 * Actions, plan/08 §8.3 gating + audit).
 *
 * The Flight quick-actions bar + audit-log viewer, with the pure
 * confirm→command→audit flow underneath. Cross-module consumers import from
 * here, never deep paths (conventions plan/implementation/00 §0.3). Importing
 * this module registers the `actions.*` + `audit.*` i18n strings as a side
 * effect.
 *
 * T2.11 owns the wiring: it supplies the real {@link CommandClient}, the shell's
 * `confirm` ({@link import('../../../../contracts').UiRegistry.confirm}), a
 * shared {@link AuditLog}, and a reactive active-vehicle accessor, and mounts
 * `ActionsBar` + `AuditPanel` (importing `actions.css`). The map layer issues
 * the coordinate-driven actions (`guidedGoto`, `setRoi`) via {@link runAction}.
 *
 * @see ./README.md for the action list, gating/confirm design and testing.
 */
import './messages';

export { ActionsBar, type ActionsBarProps, type PromptFn } from './actions-bar';
export { AuditPanel, type AuditPanelProps, type AuditExportFormat } from './audit-panel';
export { runAction, gateContextFor } from './run';
export { ACTIONS, ACTION_LIST, modeNamesFor, type ActionDescriptor } from './catalog';
export { ACTIONS_MESSAGES, AUDIT_MESSAGES, registerActionsMessages } from './messages';
export {
  IN_AIR_ALT_M,
  type ActionId,
  type ActionArgs,
  type ActionVehicle,
  type ActionGateContext,
  type ActionsDeps,
  type ActionOutcome,
  type ActionOutcomeStatus,
  type ConfirmFn,
  type TFn,
} from './types';
