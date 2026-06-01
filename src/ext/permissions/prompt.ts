/**
 * Install-time permission prompt flow (task T7.2; spec plan/06 §6.3/§6.5).
 *
 * On install the user reviews the permissions an extension's manifest declares
 * and approves a (possibly reduced) subset. This module is UI-agnostic: the
 * actual prompt is injected as {@link GrantPrompt}, so the host/UI owns
 * rendering + approve/deny, while {@link requestGrants} owns the *policy* —
 * flag high-risk scopes, never grant a scope the manifest did not request, and
 * persist the approved set into the {@link GrantStore}.
 */
import type { ExtManifest, Permission } from '../../contracts';
import type { GrantStore } from './grant-store';
import { isHighRiskPermission } from './risk';

/** One requested permission, annotated for prompt emphasis. */
export interface PermissionRequest {
  /** The requested scope. */
  permission: Permission;
  /** Whether to emphasise it as high-risk (spec plan/06 §6.5). */
  highRisk: boolean;
}

/**
 * The injected prompt: shown the manifest + annotated requests, it resolves with
 * the permissions the user approved (a subset of the requested scopes). Deny-all
 * resolves to `[]`.
 */
export type GrantPrompt = (
  manifest: ExtManifest,
  requests: readonly PermissionRequest[],
) => Promise<readonly Permission[]>;

/** Annotate a manifest's declared permissions for the prompt. */
export function describePermissionRequests(manifest: ExtManifest): PermissionRequest[] {
  return manifest.permissions.map((permission) => ({
    permission,
    highRisk: isHighRiskPermission(permission),
  }));
}

/**
 * Run the install-prompt flow for `manifest`: present its requested permissions
 * to `prompt`, then persist the approved subset into `grants`. The result is
 * clamped to the manifest's declared scopes — the prompt can only *narrow*, it
 * can never grant a scope the extension did not ask for. Returns the persisted
 * granted set.
 */
export async function requestGrants(
  manifest: ExtManifest,
  deps: { prompt: GrantPrompt; grants: GrantStore },
): Promise<Permission[]> {
  const requests = describePermissionRequests(manifest);
  const approved = await deps.prompt(manifest, requests);

  const requested = new Set<Permission>(manifest.permissions);
  const granted: Permission[] = [];
  const seen = new Set<Permission>();
  for (const perm of approved) {
    if (requested.has(perm) && !seen.has(perm)) {
      seen.add(perm);
      granted.push(perm);
    }
  }

  await deps.grants.set(manifest.id, granted);
  return granted;
}
