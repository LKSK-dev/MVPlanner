/**
 * Permission-broker errors (task T7.2; spec plan/06 §6.5/§6.6, plan/08 §8.3).
 *
 * A single typed error so callers (the sandbox guest, scripting console, the
 * host) can distinguish a *permission/gating* failure (method absent, ungranted
 * scope, blocked egress, declined confirmation) from a handler's own runtime
 * error. The broker never lets a handler error crash the host; it surfaces as a
 * rejected `invoke` promise (marshalled back across the worker boundary).
 */

/** Reason a brokered call was refused (distinct from a handler throwing). */
export type ExtPermissionDenial =
  | 'unknown-method'
  | 'not-granted'
  | 'egress-blocked'
  | 'declined'
  | 'bad-request';

/** Thrown when the {@link import('./broker').PermissionBroker} refuses a call. */
export class ExtPermissionError extends Error {
  /** Machine-readable denial reason. */
  readonly reason: ExtPermissionDenial;

  constructor(reason: ExtPermissionDenial, message: string) {
    super(message);
    this.name = 'ExtPermissionError';
    this.reason = reason;
  }
}

/** Best-effort message extraction for an unknown thrown value. */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : String(err);
}
