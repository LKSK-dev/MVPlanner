/**
 * Shared error-message coercion (refactor: canonical implementation — replaces
 * per-module duplicate `errorMessage` helpers).
 *
 * Dependency-free so any layer (core, transport, ext, ui) can import it.
 */

/** Coerce an unknown thrown value to a human-readable message. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
