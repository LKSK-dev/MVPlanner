/**
 * Per-extension permission grant store (task T7.2; spec plan/06 §6.5).
 *
 * Persists the set of {@link Permission}s an operator has approved for each
 * extension, via the injected {@link KvStore}. The user approves on install
 * (see {@link import('./prompt').requestGrants}) and can review/revoke later —
 * `grant` / `revoke` / `set` mutate + persist, `list` / `isGranted` read.
 *
 * An in-memory cache (hydrated lazily per extension on first access) keeps reads
 * cheap and survives within a session; it is always kept consistent with the
 * persisted value, so a fresh store constructed over the same {@link KvStore}
 * reads back the same grants.
 */
import type { KvStore, Permission } from '../../contracts';

/** Default {@link KvStore} namespace for persisted grants. */
export const GRANTS_NAMESPACE = 'ext.permissions';

/** The grant-store surface the broker + prompt flow depend on. */
export interface GrantStore {
  /** All permissions currently granted to `extId` (hydrating from storage). */
  list(extId: string): Promise<readonly Permission[]>;
  /** Whether the exact `permission` literal is granted to `extId`. */
  isGranted(extId: string, permission: Permission): Promise<boolean>;
  /** Add `permissions` to `extId`'s granted set (idempotent) and persist. */
  grant(extId: string, permissions: readonly Permission[]): Promise<void>;
  /** Remove `permissions` from `extId`'s granted set and persist. */
  revoke(extId: string, permissions: readonly Permission[]): Promise<void>;
  /** Replace `extId`'s entire granted set (used by the install prompt). */
  set(extId: string, permissions: readonly Permission[]): Promise<void>;
  /** Forget all grants for `extId` (used on uninstall). */
  clear(extId: string): Promise<void>;
}

/** {@link GrantStore} backed by a {@link KvStore} with a per-session cache. */
class KvGrantStore implements GrantStore {
  readonly #storage: KvStore;
  readonly #ns: string;
  readonly #cache = new Map<string, Set<Permission>>();

  constructor(storage: KvStore, ns: string) {
    this.#storage = storage;
    this.#ns = ns;
  }

  async #ensure(extId: string): Promise<Set<Permission>> {
    const cached = this.#cache.get(extId);
    if (cached) return cached;
    const stored = await this.#storage.get<Permission[]>(this.#ns, extId);
    const set = new Set<Permission>(stored ?? []);
    this.#cache.set(extId, set);
    return set;
  }

  async #persist(extId: string, set: Set<Permission>): Promise<void> {
    this.#cache.set(extId, set);
    await this.#storage.set<Permission[]>(this.#ns, extId, [...set]);
  }

  async list(extId: string): Promise<readonly Permission[]> {
    return [...(await this.#ensure(extId))];
  }

  async isGranted(extId: string, permission: Permission): Promise<boolean> {
    return (await this.#ensure(extId)).has(permission);
  }

  async grant(extId: string, permissions: readonly Permission[]): Promise<void> {
    const set = new Set(await this.#ensure(extId));
    for (const p of permissions) set.add(p);
    await this.#persist(extId, set);
  }

  async revoke(extId: string, permissions: readonly Permission[]): Promise<void> {
    const set = new Set(await this.#ensure(extId));
    for (const p of permissions) set.delete(p);
    await this.#persist(extId, set);
  }

  async set(extId: string, permissions: readonly Permission[]): Promise<void> {
    await this.#persist(extId, new Set<Permission>(permissions));
  }

  async clear(extId: string): Promise<void> {
    this.#cache.delete(extId);
    await this.#storage.del(this.#ns, extId);
  }
}

/** Build a {@link GrantStore} over `storage` (namespace defaults to {@link GRANTS_NAMESPACE}). */
export function createGrantStore(storage: KvStore, ns: string = GRANTS_NAMESPACE): GrantStore {
  return new KvGrantStore(storage, ns);
}
