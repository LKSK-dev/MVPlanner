/** App / API / dialect version constants (surfaced in About — spec plan/08 §8.5). */
export const APP_VERSION = '0.0.0';
/** Public extension API version (semver-locked at M7 — spec plan/06 §6.10). */
export const EXT_API_VERSION = '1.0.0-pre';
/** Build hash is injected at build time; 'dev' in development. */
export const BUILD_HASH = (import.meta.env?.VITE_BUILD_HASH as string | undefined) ?? 'dev';
