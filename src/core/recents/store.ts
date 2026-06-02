/**
 * Recents store for the App Settings → Recents section (spec docs/appsettings
 * §5.1/§7.3). Records recently opened/saved plans, logs, tlogs and param files
 * and (when small enough) caches their content so they can be re-opened offline
 * from `file://` without a file picker.
 *
 * Backed by the injected {@link KvStore} (metadata list) + {@link BlobStore}
 * (cached content). Framework-agnostic: exposes a snapshot + subscribe so the
 * UI can wrap it in a signal, and is unit-testable with in-memory fakes.
 */
import type { BlobStore, KvStore } from '../../contracts';

/** Kind of recent item. */
export type RecentKind = 'plan' | 'log' | 'tlog' | 'param';

/** One recents list entry (metadata; content lives in the blob store). */
export interface RecentEntry {
  readonly id: string;
  readonly kind: RecentKind;
  readonly name: string;
  /** Epoch ms when opened/saved. */
  readonly openedAt: number;
  readonly sizeBytes: number;
  /** True when the content is cached and can be re-opened without a picker. */
  readonly cached: boolean;
}

/** KV/blob namespace for recents. */
const NS = 'recents';
/** KV key for the metadata list. */
const LIST_KEY = 'list';
/** Default maximum number of retained entries. */
const DEFAULT_MAX_ENTRIES = 20;
/** Default total cached-content budget (16 MiB). */
const DEFAULT_MAX_CACHE_BYTES = 16 * 1024 * 1024;

/** Dependencies for {@link createRecentsStore}. */
export interface RecentsStoreOptions {
  readonly kv: KvStore;
  readonly blobs: BlobStore;
  /** Clock (default `Date.now`). */
  readonly now?: () => number;
  readonly maxEntries?: number;
  readonly maxCacheBytes?: number;
  /** Id generator (default time + random); injectable for deterministic tests. */
  readonly makeId?: () => string;
}

/** A recorded item to add to recents. */
export interface RecordInput {
  readonly kind: RecentKind;
  readonly name: string;
  readonly blob: Blob;
}

/** Live recents store. */
export interface RecentsStore {
  /** Hydrate the in-memory list from persistence (call once at startup). */
  load(): Promise<void>;
  /** Current entries, newest first. */
  snapshot(): readonly RecentEntry[];
  /** Subscribe to list changes; returns an unsubscribe. */
  subscribe(listener: (entries: readonly RecentEntry[]) => void): () => void;
  /** Record an opened/saved file (caches content when within budget). */
  record(input: RecordInput): Promise<RecentEntry>;
  /** Re-open a cached entry's content, or `undefined` when not cached. */
  open(id: string): Promise<{ name: string; blob: Blob } | undefined>;
  /** Remove one entry (and its cached content). */
  remove(id: string): Promise<void>;
  /** Remove all entries + cached content. */
  clear(): Promise<void>;
}

/** Create a {@link RecentsStore}. */
export function createRecentsStore(options: RecentsStoreOptions): RecentsStore {
  const { kv, blobs } = options;
  const now = options.now ?? ((): number => Date.now());
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxCacheBytes = options.maxCacheBytes ?? DEFAULT_MAX_CACHE_BYTES;
  let counter = 0;
  const makeId =
    options.makeId ??
    ((): string => {
      counter += 1;
      return `${now().toString(36)}-${counter.toString(36)}`;
    });

  let entries: RecentEntry[] = [];
  const listeners = new Set<(entries: readonly RecentEntry[]) => void>();

  const notify = (): void => {
    for (const listener of listeners) listener(entries);
  };
  const persist = async (): Promise<void> => {
    await kv.set(NS, LIST_KEY, entries);
  };
  const dropBlob = async (id: string): Promise<void> => {
    try {
      await blobs.del(NS, id);
    } catch {
      /* best-effort: a missing/uncached blob is fine */
    }
  };

  return {
    async load(): Promise<void> {
      const stored = await kv.get<RecentEntry[]>(NS, LIST_KEY);
      entries = Array.isArray(stored) ? stored.slice() : [];
      notify();
    },

    snapshot(): readonly RecentEntry[] {
      return entries;
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      listener(entries);
      return (): void => {
        listeners.delete(listener);
      };
    },

    async record(input): Promise<RecentEntry> {
      // Drop any prior entry for the same kind+name (and its blob).
      const dupes = entries.filter((e) => e.kind === input.kind && e.name === input.name);
      for (const dupe of dupes) await dropBlob(dupe.id);
      entries = entries.filter((e) => !(e.kind === input.kind && e.name === input.name));

      const id = makeId();
      const sizeBytes = input.blob.size;
      const cacheable = sizeBytes > 0 && sizeBytes <= maxCacheBytes;
      let cached = false;
      if (cacheable) {
        try {
          await blobs.put(NS, id, input.blob);
          cached = true;
        } catch {
          cached = false;
        }
      }
      const entry: RecentEntry = {
        id,
        kind: input.kind,
        name: input.name,
        openedAt: now(),
        sizeBytes,
        cached,
      };
      entries = [entry, ...entries];

      // Trim to the max entry count (delete overflow blobs).
      if (entries.length > maxEntries) {
        for (const overflow of entries.slice(maxEntries)) await dropBlob(overflow.id);
        entries = entries.slice(0, maxEntries);
      }

      // Enforce the cached-bytes budget: uncache oldest cached entries first.
      let cachedTotal = entries.reduce((sum, e) => sum + (e.cached ? e.sizeBytes : 0), 0);
      if (cachedTotal > maxCacheBytes) {
        for (let i = entries.length - 1; i >= 0 && cachedTotal > maxCacheBytes; i -= 1) {
          const e = entries[i];
          if (e === undefined || !e.cached) continue;
          await dropBlob(e.id);
          entries[i] = { ...e, cached: false };
          cachedTotal -= e.sizeBytes;
        }
      }

      await persist();
      notify();
      return entry;
    },

    async open(id): Promise<{ name: string; blob: Blob } | undefined> {
      const entry = entries.find((e) => e.id === id);
      if (entry === undefined || !entry.cached) return undefined;
      try {
        const size = await blobs.size(NS, id);
        const bytes = await blobs.getRange(NS, id, 0, size);
        const copy = bytes.slice();
        return { name: entry.name, blob: new Blob([copy]) };
      } catch {
        return undefined;
      }
    },

    async remove(id): Promise<void> {
      if (!entries.some((e) => e.id === id)) return;
      await dropBlob(id);
      entries = entries.filter((e) => e.id !== id);
      await persist();
      notify();
    },

    async clear(): Promise<void> {
      for (const e of entries) await dropBlob(e.id);
      entries = [];
      await persist();
      notify();
    },
  };
}
