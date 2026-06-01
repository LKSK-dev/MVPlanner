/**
 * Extension manifest parsing + validation (task T7.1; spec plan/06 §6.2).
 *
 * Narrows an untrusted `unknown` (a manifest object, or the `manifest` export of
 * a single-file `.mvpext.js`) into the frozen {@link ExtManifest} contract,
 * throwing {@link ExtManifestError} with a clear message on any malformed or
 * incompatible field. apiVersion is checked as a semver **range** against the
 * host {@link EXT_API_VERSION}.
 */
import type { ExtContributes, ExtManifest, Permission } from '../../contracts';
import { EXT_API_VERSION } from '../../version';
import { ExtManifestError } from './errors';
import { parseSemVer, satisfiesRange } from './semver';

/** Fixed permission scopes (spec plan/06 §6.5); `net:<host>` is matched by prefix. */
const PERMISSIONS: ReadonlySet<string> = new Set<string>([
  'telemetry:read',
  'mavlink:send',
  'command',
  'params:write',
  'mission:write',
  'ui:panel',
  'map',
  'notify',
  'files',
  'storage',
  'transport',
  'dialect',
]);

function asRecord(input: unknown, label: string): Record<string, unknown> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new ExtManifestError(`${label} must be an object`);
  }
  return input as Record<string, unknown>;
}

function requireString(m: Record<string, unknown>, key: string): string {
  const v = m[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ExtManifestError(`manifest.${key} is required and must be a non-empty string`);
  }
  return v;
}

function optionalString(m: Record<string, unknown>, key: string): string | undefined {
  const v = m[key];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new ExtManifestError(`manifest.${key} must be a string`);
  return v;
}

function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS.has(value) || value.startsWith('net:'));
}

function requirePermissions(value: unknown): Permission[] {
  if (!Array.isArray(value)) {
    throw new ExtManifestError('manifest.permissions is required and must be an array');
  }
  const out: Permission[] = [];
  for (const entry of value) {
    if (!isPermission(entry)) {
      throw new ExtManifestError(
        `manifest.permissions has an unknown scope: ${JSON.stringify(entry)}`,
      );
    }
    out.push(entry);
  }
  return out;
}

/**
 * Parse + validate a manifest. Structural only — apiVersion is checked for a
 * valid range shape but compatibility with the host is a separate concern
 * ({@link isApiVersionCompatible}).
 *
 * @throws {@link ExtManifestError} on any malformed field.
 */
export function parseManifest(input: unknown): ExtManifest {
  const m = asRecord(input, 'manifest');

  const id = requireString(m, 'id');
  if (/\s/.test(id)) throw new ExtManifestError('manifest.id must not contain whitespace');
  const name = requireString(m, 'name');
  const version = requireString(m, 'version');
  parseSemVer(version); // validate the extension's own version is real semver
  const apiVersion = requireString(m, 'apiVersion');
  // Validate the range parses by evaluating it against a dummy version.
  satisfiesRange('0.0.0', apiVersion);
  const permissions = requirePermissions(m.permissions);

  const description = optionalString(m, 'description');
  const author = optionalString(m, 'author');
  const icon = optionalString(m, 'icon');
  const homepage = optionalString(m, 'homepage');
  const minAppVersion = optionalString(m, 'minAppVersion');
  if (minAppVersion !== undefined) parseSemVer(minAppVersion);

  let contributes: ExtContributes | undefined;
  if (m.contributes !== undefined) {
    // Shallow check only: contribution items (panels/commands) carry runtime
    // functions supplied by the extension at activation, not validated here.
    contributes = asRecord(m.contributes, 'manifest.contributes') as ExtContributes;
  }

  let dependencies: Record<string, string> | undefined;
  if (m.dependencies !== undefined) {
    const deps = asRecord(m.dependencies, 'manifest.dependencies');
    for (const [k, v] of Object.entries(deps)) {
      if (typeof v !== 'string') {
        throw new ExtManifestError(`manifest.dependencies.${k} must be a version-range string`);
      }
    }
    dependencies = deps as Record<string, string>;
  }

  return {
    id,
    name,
    version,
    apiVersion,
    permissions,
    ...(description !== undefined ? { description } : {}),
    ...(author !== undefined ? { author } : {}),
    ...(icon !== undefined ? { icon } : {}),
    ...(homepage !== undefined ? { homepage } : {}),
    ...(minAppVersion !== undefined ? { minAppVersion } : {}),
    ...(contributes !== undefined ? { contributes } : {}),
    ...(dependencies !== undefined ? { dependencies } : {}),
  };
}

/** Does the manifest's `apiVersion` range accept the host API version? */
export function isApiVersionCompatible(
  apiVersionRange: string,
  current = EXT_API_VERSION,
): boolean {
  return satisfiesRange(current, apiVersionRange);
}
