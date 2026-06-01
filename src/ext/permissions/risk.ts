/**
 * Permission risk classification (task T7.2; spec plan/06 §6.5, plan/08 §8.3).
 *
 * Two distinct, deliberately separate sets:
 *
 *  - {@link HIGH_RISK_PERMISSIONS} — scopes flagged for *emphasis in the install
 *    prompt* (spec plan/06 §6.5 "flagged in the install prompt"). Anything that
 *    can change vehicle state or open a new attack surface: `command`,
 *    `params:write`, `mission:write`, `mavlink:send`, `transport`, `dialect`.
 *
 *  - {@link VEHICLE_AFFECTING_PERMISSIONS} — the subset whose *individual calls*
 *    are routed through an armed-aware confirmation **and** written to the audit
 *    log (spec plan/08 §8.3 destructive-action gating): `command`,
 *    `params:write`, `mission:write`, `mavlink:send`. `transport`/`dialect` are
 *    high-risk to *grant* but their calls are not per-action vehicle commands,
 *    so they are not confirm-gated here.
 */
import type { Permission } from '../../contracts';
import type { AuditKind } from '../../core/audit';

/** Scopes emphasised as high-risk in the install prompt (spec plan/06 §6.5). */
export const HIGH_RISK_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'command',
  'params:write',
  'mission:write',
  'mavlink:send',
  'transport',
  'dialect',
]);

/**
 * Scopes whose calls are confirm-gated + audit-logged per action (spec plan/08
 * §8.3). A strict subset of {@link HIGH_RISK_PERMISSIONS}.
 */
export const VEHICLE_AFFECTING_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'command',
  'params:write',
  'mission:write',
  'mavlink:send',
]);

/** Is `perm` emphasised as high-risk in the install prompt? */
export function isHighRiskPermission(perm: Permission): boolean {
  return HIGH_RISK_PERMISSIONS.has(perm);
}

/** Is `perm` a vehicle-affecting scope whose calls are confirm-gated + audited? */
export function isVehicleAffectingPermission(perm: Permission): boolean {
  return VEHICLE_AFFECTING_PERMISSIONS.has(perm);
}

/**
 * Map a vehicle-affecting permission to its {@link AuditKind}. The audit log's
 * frozen kinds are `command` / `param-set` / `mission-write`; `mavlink:send`
 * (an arbitrary vehicle-bound frame) is recorded as a `command`.
 */
export function auditKindForPermission(perm: Permission): AuditKind | undefined {
  switch (perm) {
    case 'params:write':
      return 'param-set';
    case 'mission:write':
      return 'mission-write';
    case 'command':
    case 'mavlink:send':
      return 'command';
    default:
      return undefined;
  }
}
