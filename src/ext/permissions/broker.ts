/**
 * Permission broker (task T7.2; spec plan/06 §6.4/§6.5/§6.6, plan/08 §8.3).
 *
 * The broker is the single mediation point between an extension and every
 * privileged capability. The sandbox guest never holds a real service client —
 * it only holds a proxy that posts an RPC to {@link PermissionBroker.invoke}.
 * For each registered API method the broker enforces, in order:
 *
 *  1. **Existence** — an unregistered method is rejected (`unknown-method`).
 *  2. **Permission** — the method's `required` scope must be granted, else the
 *     call is rejected (`not-granted`). Combined with
 *     {@link PermissionBroker.capabilitiesFor}, a missing permission means the
 *     method is *absent* from the guest proxy (spec plan/06 §6.5 "No permission
 *     ⇒ the method is absent, not just a no-op"), and `invoke` enforces it again
 *     as defence-in-depth.
 *  3. **Egress gating** — `net:<host>` methods gate the per-call host against the
 *     granted hosts and record the egress (spec plan/06 §6.5, plan/07 §7.7).
 *  4. **Destructive-action gating** — vehicle-affecting calls (`command`,
 *     `params:write`, `mission:write`, `mavlink:send`) route through an
 *     armed-aware {@link ConfirmFn} and are written to the {@link AuditLog} with
 *     `origin` = the extension id (spec plan/08 §8.3). A declined confirm blocks
 *     the call and records it as `cancelled`.
 *  5. **Error isolation** — a handler that throws surfaces as a rejected promise
 *     (and an `error` audit entry); it never crashes the broker/host.
 *
 * The broker is transport-agnostic: it is unit-testable directly and also drives
 * the sandbox guest over RPC (in-process for tests, a real Worker in-browser).
 */
import type { ConfirmOptions, Permission } from '../../contracts';
import type { AuditKind, AuditLog } from '../../core/audit';
import { ExtPermissionError } from './errors';
import type { GrantStore } from './grant-store';
import { auditKindForPermission, isVehicleAffectingPermission } from './risk';

/** A registered API handler. `args` are the (structured-cloneable) call args. */
export type ApiHandler = (
  extId: string,
  args: readonly unknown[],
  signal?: AbortSignal,
) => Promise<unknown>;

/** Armed-aware confirmation, shaped like `UiRegistry.confirm`. */
export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

/** A recorded network egress (spec plan/06 §6.5, plan/07 §7.7). */
export interface EgressRecord {
  extId: string;
  url: string;
  host: string;
}

/** Optional per-registration overrides. */
export interface RegisterOptions {
  /**
   * Mark this method as network egress: instead of a fixed `required` scope, the
   * per-call host is gated against the extension's granted `net:<host>` scopes
   * and the egress is recorded.
   */
  net?: boolean;
  /** Override the audit kind for a vehicle-affecting method. */
  auditKind?: AuditKind;
  /** Human-readable action summary (audit entry + confirm body). */
  summary?: string;
}

/** Injected broker dependencies (pass fakes in tests). */
export interface PermissionBrokerDeps {
  grants: GrantStore;
  confirm: ConfirmFn;
  audit: AuditLog;
  /** Sink for recorded network egress; defaults to a no-op. */
  recordEgress?: (info: EgressRecord) => void;
}

interface Registration {
  method: string;
  required: Permission | null;
  handler: ApiHandler;
  net: boolean;
  auditKind?: AuditKind;
  summary?: string;
}

/** Resolved host for a network egress call. */
interface EgressTarget {
  url: string;
  host: string;
  hostname: string;
}

/** Pull the egress target out of a `net` call's first argument. */
function resolveEgressTarget(args: readonly unknown[]): EgressTarget {
  const raw = args[0];
  if (typeof raw !== 'string') {
    throw new ExtPermissionError(
      'bad-request',
      'net call requires a URL string as its first argument',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ExtPermissionError(
      'bad-request',
      `net call has an invalid URL: ${JSON.stringify(raw)}`,
    );
  }
  return { url: url.href, host: url.host, hostname: url.hostname };
}

/** Is egress to `target` permitted by the granted scopes? */
function isHostGranted(granted: ReadonlySet<Permission>, target: EgressTarget): boolean {
  return (
    granted.has('net:*') ||
    granted.has(`net:${target.host}`) ||
    granted.has(`net:${target.hostname}`)
  );
}

export class PermissionBroker {
  readonly #deps: PermissionBrokerDeps;
  readonly #apis = new Map<string, Registration>();

  constructor(deps: PermissionBrokerDeps) {
    this.#deps = deps;
  }

  /**
   * Register an API method. `required` is the permission that gates it (or
   * `null` for an always-available method). Pass `{ net: true }` for an egress
   * method (per-call host gating instead of a fixed scope).
   */
  registerApi(
    method: string,
    required: Permission | null,
    handler: ApiHandler,
    opts: RegisterOptions = {},
  ): () => void {
    const reg: Registration = {
      method,
      required,
      handler,
      net: opts.net ?? false,
      ...(opts.auditKind !== undefined ? { auditKind: opts.auditKind } : {}),
      ...(opts.summary !== undefined ? { summary: opts.summary } : {}),
    };
    this.#apis.set(method, reg);
    return (): void => {
      if (this.#apis.get(method) === reg) this.#apis.delete(method);
    };
  }

  /** Registered method names (regardless of grants). */
  registeredMethods(): string[] {
    return [...this.#apis.keys()];
  }

  /**
   * The set of method names available to `extId` given its current grants — the
   * exact surface the sandbox proxy should expose. A method is available when
   * its `required` scope is granted (or it has none); a `net` method is
   * available when the extension holds any `net:<host>` grant.
   */
  async capabilitiesFor(extId: string): Promise<Set<string>> {
    const granted = new Set<Permission>(await this.#deps.grants.list(extId));
    const out = new Set<string>();
    for (const reg of this.#apis.values()) {
      if (reg.net) {
        if ([...granted].some((p) => p.startsWith('net:'))) out.add(reg.method);
      } else if (reg.required === null || granted.has(reg.required)) {
        out.add(reg.method);
      }
    }
    return out;
  }

  /**
   * Invoke a brokered method on behalf of `extId`. Enforces existence,
   * permission, egress gating, destructive-action confirmation + audit, and
   * isolates handler errors. Rejects with {@link ExtPermissionError} on a
   * gating failure, or the handler's own error on a handler fault.
   */
  async invoke(
    extId: string,
    method: string,
    args: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const reg = this.#apis.get(method);
    if (!reg) {
      throw new ExtPermissionError('unknown-method', `no such API method: "${method}"`);
    }

    const granted = new Set<Permission>(await this.#deps.grants.list(extId));

    if (reg.net) {
      const target = resolveEgressTarget(args);
      if (!isHostGranted(granted, target)) {
        throw new ExtPermissionError(
          'egress-blocked',
          `extension "${extId}" is not permitted to reach "${target.host}"`,
        );
      }
      this.#deps.recordEgress?.({ extId, url: target.url, host: target.host });
      return this.#run(reg, extId, args, signal);
    }

    if (reg.required !== null && !granted.has(reg.required)) {
      throw new ExtPermissionError(
        'not-granted',
        `extension "${extId}" lacks permission "${reg.required}" for method "${method}"`,
      );
    }

    if (reg.required !== null && isVehicleAffectingPermission(reg.required)) {
      return this.#invokeAudited(reg, reg.required, extId, args, signal);
    }

    return this.#run(reg, extId, args, signal);
  }

  /** Run a handler, isolating its faults into a rejected promise. */
  async #run(
    reg: Registration,
    extId: string,
    args: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    return reg.handler(extId, args, signal);
  }

  /** Confirm + audit-wrap a vehicle-affecting call (spec plan/08 §8.3). */
  async #invokeAudited(
    reg: Registration,
    perm: Permission,
    extId: string,
    args: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const kind: AuditKind = reg.auditKind ?? auditKindForPermission(perm) ?? 'command';
    const summary = reg.summary ?? `${extId} → ${reg.method}`;
    const entry = this.#deps.audit.append({
      kind,
      summary,
      origin: extId,
      status: 'pending',
    });

    const opts: ConfirmOptions = {
      title: 'Extension action',
      body: summary,
      destructive: true,
      armedAware: true,
    };
    const approved = await this.#deps.confirm(opts);
    if (!approved) {
      this.#deps.audit.update(entry.id, { status: 'cancelled', result: 'declined' });
      throw new ExtPermissionError(
        'declined',
        `operator declined extension action "${reg.method}"`,
      );
    }

    try {
      const result = await reg.handler(extId, args, signal);
      this.#deps.audit.update(entry.id, { status: 'ok', result: 'ok' });
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.#deps.audit.update(entry.id, { status: 'error', result: message });
      throw err;
    }
  }
}

/** Construct a {@link PermissionBroker}. */
export function createPermissionBroker(deps: PermissionBrokerDeps): PermissionBroker {
  return new PermissionBroker(deps);
}
