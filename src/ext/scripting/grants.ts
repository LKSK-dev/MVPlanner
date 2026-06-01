/**
 * Scripting permission profile + grant store (task T7.4; spec plan/06 §6.7
 * "mvp … subject to a scripting permission profile the user controls").
 *
 * The console runs the USER's own script in the main realm with `mvp` = an
 * {@link import('../../contracts').ExtContext} built for THIS profile. The user
 * controls which permissions are granted (a permission toggles the surface that
 * appears on `mvp`); vehicle-affecting permissions are OFF by default so the
 * console is safe out of the box. Grants persist via an injected
 * {@link KvStore}; the set drives the `makeContext(grants)` the console UI
 * injects.
 */
import type { KvStore, Permission } from '../../contracts';
import type { ScriptingGrants } from './types';

/** Stable pseudo-extension id used for the scripting console's audit origin. */
export const SCRIPTING_EXT_ID = 'mvp.scripting.console';

/** Default KV namespace + key for the persisted grant set. */
const DEFAULT_NAMESPACE = 'scripting';
const GRANTS_KEY = 'grants';

/**
 * Every permission the scripting console can be granted. `net:*` is represented
 * by the catch-all `net:*` token here (the UI lets the user scope a host); the
 * concrete `net:<host>` grants are produced when the user enables networking.
 */
export const SCRIPTING_PERMISSIONS: readonly Permission[] = [
  'telemetry:read',
  'notify',
  'storage',
  'ui:panel',
  'map',
  'command',
  'mavlink:send',
  'params:write',
  'mission:write',
  'files',
  'net:*',
  'transport',
  'dialect',
];

/**
 * Safe-by-default grants: read telemetry, notify, and per-extension storage.
 * Everything vehicle-affecting (command / mavlink:send / params:write /
 * mission:write) and networking is OFF until the user toggles it on.
 */
export const DEFAULT_SCRIPTING_GRANTS: ScriptingGrants = ['telemetry:read', 'notify', 'storage'];

/** Persisted, user-controlled scripting grant set. */
export interface ScriptingGrantStore {
  /** The current grant set (defaults to {@link DEFAULT_SCRIPTING_GRANTS} when unset). */
  list(): Promise<Permission[]>;
  /** Replace the whole grant set. */
  set(permissions: ScriptingGrants): Promise<Permission[]>;
  /** Enable / disable one permission; returns the resulting set. */
  toggle(permission: Permission, on: boolean): Promise<Permission[]>;
}

/** Injected dependencies for {@link createScriptingGrantStore}. */
export interface ScriptingGrantStoreDeps {
  storage: KvStore;
  namespace?: string;
  /** Initial grants when nothing is persisted yet (default {@link DEFAULT_SCRIPTING_GRANTS}). */
  defaults?: ScriptingGrants;
}

/** De-duplicate a permission list while preserving order. */
function dedupe(perms: ScriptingGrants): Permission[] {
  return [...new Set(perms)];
}

/** Build a {@link ScriptingGrantStore} over the injected KV store. */
export function createScriptingGrantStore(deps: ScriptingGrantStoreDeps): ScriptingGrantStore {
  const ns = deps.namespace ?? DEFAULT_NAMESPACE;
  const defaults = deps.defaults ?? DEFAULT_SCRIPTING_GRANTS;

  const read = async (): Promise<Permission[]> => {
    const raw = await deps.storage.get<Permission[]>(ns, GRANTS_KEY);
    return Array.isArray(raw) ? dedupe(raw) : dedupe(defaults);
  };

  return {
    list: read,
    async set(permissions): Promise<Permission[]> {
      const next = dedupe(permissions);
      await deps.storage.set(ns, GRANTS_KEY, next);
      return next;
    },
    async toggle(permission, on): Promise<Permission[]> {
      const current = await read();
      const has = current.includes(permission);
      let next = current;
      if (on && !has) next = [...current, permission];
      else if (!on && has) next = current.filter((p) => p !== permission);
      await deps.storage.set(ns, GRANTS_KEY, next);
      return next;
    },
  };
}
