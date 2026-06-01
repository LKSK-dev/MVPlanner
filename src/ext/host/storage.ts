/**
 * Per-extension scoped KV store (task T7.1; spec plan/06 §6.4 `ctx.storage`).
 *
 * Wraps the injected {@link KvStore} into a single reserved namespace per
 * extension (`<base>.data.<id>`) exposing key-only get/set/del — the seam
 * T7.3's `ctx.storage` is built on. A tracked key index lets the host
 * {@link clear} the whole namespace on uninstall (the {@link KvStore} contract
 * has no enumerate/clear).
 */
import type { KvStore } from '../../contracts';

/** Key-only namespaced storage handed to one extension. */
export interface ExtKvStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  del(key: string): Promise<void>;
  /** Delete every key written through this store (used on uninstall). */
  clear(): Promise<void>;
}

/** Reserved meta key holding the list of written keys for {@link ExtKvStore.clear}. */
const KEY_INDEX = '__keys__';

/** Build an {@link ExtKvStore} over `storage` bound to namespace `ns`. */
export function createExtKvStore(storage: KvStore, ns: string): ExtKvStore {
  const readIndex = async (): Promise<string[]> =>
    (await storage.get<string[]>(ns, KEY_INDEX)) ?? [];

  return {
    get<T>(key: string): Promise<T | undefined> {
      return storage.get<T>(ns, key);
    },
    async set<T>(key: string, value: T): Promise<void> {
      await storage.set<T>(ns, key, value);
      const keys = await readIndex();
      if (!keys.includes(key)) {
        keys.push(key);
        await storage.set<string[]>(ns, KEY_INDEX, keys);
      }
    },
    async del(key: string): Promise<void> {
      await storage.del(ns, key);
      const keys = await readIndex();
      const next = keys.filter((k) => k !== key);
      if (next.length !== keys.length) {
        await storage.set<string[]>(ns, KEY_INDEX, next);
      }
    },
    async clear(): Promise<void> {
      const keys = await readIndex();
      for (const key of keys) {
        await storage.del(ns, key);
      }
      await storage.del(ns, KEY_INDEX);
    },
  };
}
