/**
 * Extension host error types (task T7.1; spec plan/06 §6.2/§6.3).
 *
 * A single, narrow error class for manifest / semver validation so callers (and
 * the install UI in later tasks) can distinguish a malformed/incompatible
 * extension from an unexpected host fault.
 */

/** Thrown when a manifest, version, or apiVersion range is malformed/incompatible. */
export class ExtManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtManifestError';
  }
}

/** Coerce an unknown thrown value to a human-readable message (error isolation). */
export function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
