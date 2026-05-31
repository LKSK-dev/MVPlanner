/**
 * IndexedDB-backed tile cache (task T2.3; spec plan/07 §7.2 "Map tiles … LRU
 * eviction + manual prefetch/clear", §7.8 offline). Wraps the frozen
 * {@link BlobStore} for byte storage and an injected `fetch`-like for network
 * access — no hard-bound globals, so it is unit-testable with a mock fetch and a
 * fake-indexeddb {@link BlobStore}.
 *
 * Behaviour:
 * - Cache key is `"<sourceId>/<z>/<x>/<y>"` within the `tiles` blob namespace.
 * - {@link TileCache.get} is cache-first: a hit returns the stored bytes; a miss
 *   fetches only when `online`. Offline misses resolve to `undefined` and never
 *   throw (graceful offline per §7.8).
 * - Eviction is bounded by entry count and optional age (basic age/insertion
 *   policy — sufficient for the M2 gate; a finer LRU can replace it later).
 */
import { wrapTileX } from './mercator';
import { tileUrl } from './source';
import type { BasemapSource, BlobStore } from '../../contracts';
import type { TileCoord } from './types';

/** The blob namespace used for cached tiles. */
export const TILE_NAMESPACE = 'tiles';

/** Default cap on cached tile entries before age/insertion eviction kicks in. */
export const DEFAULT_MAX_ENTRIES = 4096;

/**
 * The minimal `fetch`-like surface the cache needs. The standard global `fetch`
 * is structurally assignable; tests pass a mock. The cache never references the
 * global directly.
 */
export type FetchFn = (url: string, init?: { signal?: AbortSignal }) => Promise<FetchResponseLike>;

/** The subset of `Response` the cache consumes. */
export interface FetchResponseLike {
  /** HTTP-success flag. */
  ok: boolean;
  /** HTTP status code (for diagnostics; non-2xx is treated as a miss). */
  status: number;
  /** Resolve the body as a {@link Blob}. */
  blob(): Promise<Blob>;
}

/** Per-tile metadata persisted alongside the bytes (drives eviction). */
interface TileMeta {
  sourceId: string;
  z: number;
  x: number;
  y: number;
  /** Epoch ms when the tile was fetched/stored. */
  fetchedAt: number;
}

/** Options for {@link createTileCache}. */
export interface TileCacheOptions {
  /** Byte store (the storage foundation's `blobs`, or a fake in tests). */
  blobs: BlobStore;
  /** Injected `fetch`-like used for network tile loads. */
  fetch: FetchFn;
  /** Blob namespace (default {@link TILE_NAMESPACE}). */
  namespace?: string;
  /** Clock (default `Date.now`), injectable for deterministic tests. */
  now?: () => number;
  /** Max cached entries before eviction (default {@link DEFAULT_MAX_ENTRIES}). */
  maxEntries?: number;
  /** Optional max tile age in ms; older tiles are evicted on {@link TileCache.evict}. */
  maxAgeMs?: number;
}

/** Options accepted by {@link TileCache.get}. */
export interface TileGetOptions {
  /** When `false`, only the cache is consulted (offline). Default `true`. */
  online?: boolean;
  /** Abort the network fetch. */
  signal?: AbortSignal;
}

/** Result of a {@link TileCache.prefetch} run. */
export interface PrefetchResult {
  /** Tiles requested. */
  requested: number;
  /** Tiles freshly fetched + stored this run. */
  fetched: number;
  /** Tiles already present in the cache. */
  cached: number;
  /** Tiles that could not be retrieved (network error / offline / non-2xx). */
  failed: number;
}

/** The tile cache surface. */
export interface TileCache {
  /** Cache-first tile load; fetches on miss when `online`. Never throws. */
  get(source: BasemapSource, tile: TileCoord, options?: TileGetOptions): Promise<Blob | undefined>;
  /** Cache-only read (no network). */
  getCached(source: BasemapSource, tile: TileCoord): Promise<Blob | undefined>;
  /** Store tile bytes for `source`/`tile`. */
  put(source: BasemapSource, tile: TileCoord, blob: Blob): Promise<void>;
  /** Whether the tile is present in the cache. */
  has(source: BasemapSource, tile: TileCoord): Promise<boolean>;
  /** Download + cache a batch of tiles (for offline area prefetch). */
  prefetch(
    source: BasemapSource,
    tiles: readonly TileCoord[],
    options?: TileGetOptions & { onProgress?: (done: number, total: number) => void },
  ): Promise<PrefetchResult>;
  /** Apply the bounded eviction policy; returns the number of tiles removed. */
  evict(): Promise<number>;
  /** Remove all cached tiles (optionally only for one source). */
  clear(sourceId?: string): Promise<void>;
}

/** Compose the stable cache key for a source + tile. */
export function tileCacheKey(sourceId: string, tile: TileCoord): string {
  const n = 2 ** tile.z;
  return `${sourceId}/${tile.z}/${wrapTileX(tile.x, n)}/${tile.y}`;
}

/**
 * Copy `bytes` into a fresh ArrayBuffer-backed `Blob`. The explicit
 * `Uint8Array(bytes)` copy guarantees an `ArrayBuffer` (not `ArrayBufferLike`)
 * backing so the value satisfies `BlobPart` under this repo's TS config; the
 * image type is sniffed from the bytes by `createImageBitmap`, so no MIME is set.
 */
function bytesToBlob(bytes: Uint8Array): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

/**
 * Create a {@link TileCache} over a {@link BlobStore} and an injected fetch.
 */
export function createTileCache(options: TileCacheOptions): TileCache {
  const { blobs, fetch: fetchFn } = options;
  const ns = options.namespace ?? TILE_NAMESPACE;
  const now = options.now ?? ((): number => Date.now());
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxAgeMs = options.maxAgeMs;

  async function getCached(source: BasemapSource, tile: TileCoord): Promise<Blob | undefined> {
    const key = tileCacheKey(source.id, tile);
    let size: number;
    try {
      size = await blobs.size(ns, key);
    } catch {
      return undefined;
    }
    const bytes = await blobs.getRange(ns, key, 0, size);
    return bytesToBlob(bytes);
  }

  async function put(source: BasemapSource, tile: TileCoord, blob: Blob): Promise<void> {
    const key = tileCacheKey(source.id, tile);
    const meta: TileMeta = {
      sourceId: source.id,
      z: tile.z,
      x: tile.x,
      y: tile.y,
      fetchedAt: now(),
    };
    await blobs.put(ns, key, blob, meta);
  }

  async function has(source: BasemapSource, tile: TileCoord): Promise<boolean> {
    const key = tileCacheKey(source.id, tile);
    try {
      await blobs.size(ns, key);
      return true;
    } catch {
      return false;
    }
  }

  async function fetchTile(
    source: BasemapSource,
    tile: TileCoord,
    signal: AbortSignal | undefined,
  ): Promise<Blob | undefined> {
    try {
      const res = await fetchFn(tileUrl(source, tile), signal ? { signal } : undefined);
      if (!res.ok) return undefined;
      const blob = await res.blob();
      await put(source, tile, blob);
      return blob;
    } catch {
      return undefined;
    }
  }

  return {
    getCached,
    put,
    has,

    async get(source, tile, getOptions): Promise<Blob | undefined> {
      const cached = await getCached(source, tile);
      if (cached !== undefined) return cached;
      const online = getOptions?.online ?? true;
      if (!online) return undefined;
      return fetchTile(source, tile, getOptions?.signal);
    },

    async prefetch(source, tiles, prefetchOptions): Promise<PrefetchResult> {
      const online = prefetchOptions?.online ?? true;
      const signal = prefetchOptions?.signal;
      const onProgress = prefetchOptions?.onProgress;
      const result: PrefetchResult = { requested: tiles.length, fetched: 0, cached: 0, failed: 0 };
      let done = 0;
      for (const tile of tiles) {
        if (signal?.aborted) break;
        if (await has(source, tile)) {
          result.cached++;
        } else if (!online) {
          result.failed++;
        } else {
          const blob = await fetchTile(source, tile, signal);
          if (blob !== undefined) result.fetched++;
          else result.failed++;
        }
        onProgress?.(++done, tiles.length);
      }
      await this.evict();
      return result;
    },

    async evict(): Promise<number> {
      const metas = await blobs.list(ns);
      const current = now();
      let removed = 0;
      const survivors: { key: string; fetchedAt: number }[] = [];
      for (const m of metas) {
        const meta = m.meta as TileMeta | undefined;
        const fetchedAt = meta?.fetchedAt ?? 0;
        if (maxAgeMs !== undefined && current - fetchedAt > maxAgeMs) {
          await blobs.del(ns, m.key);
          removed++;
        } else {
          survivors.push({ key: m.key, fetchedAt });
        }
      }
      if (survivors.length > maxEntries) {
        survivors.sort((a, b) => a.fetchedAt - b.fetchedAt);
        const over = survivors.length - maxEntries;
        for (let i = 0; i < over; i++) {
          const victim = survivors[i];
          if (victim) {
            await blobs.del(ns, victim.key);
            removed++;
          }
        }
      }
      return removed;
    },

    async clear(sourceId): Promise<void> {
      const metas = await blobs.list(ns);
      for (const m of metas) {
        if (sourceId === undefined) {
          await blobs.del(ns, m.key);
        } else if (m.key.startsWith(`${sourceId}/`)) {
          await blobs.del(ns, m.key);
        }
      }
    },
  };
}
