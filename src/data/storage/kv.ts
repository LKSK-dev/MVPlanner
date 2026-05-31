/**
 * Namespaced key/value store ({@link KvStore}) backed by the `kv` object store,
 * keyed by the composite `[ns, key]` (T0.9; contract `src/contracts/storage.ts`).
 * Values are stored as-is (structured-cloned by IndexedDB); callers own the
 * concrete value type via the method type parameter.
 */
import type { KvStore } from '../../contracts';
import { KV_STORE, type StorageDatabase } from './schema';

/**
 * Create a {@link KvStore} over a lazily-resolved database.
 *
 * @param getDb - Resolves the shared {@link StorageDatabase} (opened on demand).
 * @returns A namespaced get/set/del key/value store.
 */
export function createKvStore(getDb: () => Promise<StorageDatabase>): KvStore {
  return {
    async get<T>(ns: string, key: string): Promise<T | undefined> {
      const db = await getDb();
      const id: [string, string] = [ns, key];
      const value = await db.get(KV_STORE, id);
      return value as T | undefined;
    },
    async set<T>(ns: string, key: string, v: T): Promise<void> {
      const db = await getDb();
      const id: [string, string] = [ns, key];
      await db.put(KV_STORE, v, id);
    },
    async del(ns: string, key: string): Promise<void> {
      const db = await getDb();
      const id: [string, string] = [ns, key];
      await db.delete(KV_STORE, id);
    },
  };
}
