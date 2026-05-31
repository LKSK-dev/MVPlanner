/**
 * Tile cache tests (task T2.3; spec plan/07 §7.2 LRU/prefetch, §7.8 offline).
 * Exercises cache hit/miss against a real fake-indexeddb {@link BlobStore} with
 * an injected mock fetch — no globals touched.
 */
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createStorage, type AppStorage } from '../../src/data/storage';
import { createTileCache, tileCacheKey, type FetchFn, type TileCoord } from '../../src/geo/tiles';
import type { BasemapSource } from '../../src/contracts';

let uid = 0;
const dbName = (): string => `mvp-tiles-${Date.now()}-${uid++}`;

function newStorage(): AppStorage {
  return createStorage({ name: dbName(), requestPersistence: false });
}

const SOURCE: BasemapSource = { id: 'osm', kind: 'xyz', url: 'https://t/{z}/{x}/{y}.png' };

/** A mock fetch that returns a unique 4-byte PNG-ish blob per URL and counts calls. */
function mockFetch(): { fn: FetchFn; calls: () => string[] } {
  const calls: string[] = [];
  const fn: FetchFn = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      blob: async () => new Blob([new Uint8Array([1, 2, 3, 4])]),
    };
  };
  return { fn, calls: () => calls };
}

const TILE: TileCoord = { z: 3, x: 2, y: 5 };

afterEach(() => vi.restoreAllMocks());

describe('TileCache get', () => {
  it('fetches on a miss, then serves from cache (no second fetch)', async () => {
    const { blobs } = newStorage();
    const { fn, calls } = mockFetch();
    const cache = createTileCache({ blobs, fetch: fn });

    const first = await cache.get(SOURCE, TILE, { online: true });
    expect(first).toBeInstanceOf(Blob);
    expect(await first!.arrayBuffer().then((b) => b.byteLength)).toBe(4);
    expect(calls()).toEqual(['https://t/3/2/5.png']);

    const second = await cache.get(SOURCE, TILE, { online: true });
    expect(second).toBeInstanceOf(Blob);
    expect(calls()).toHaveLength(1); // served from cache
    expect(await cache.has(SOURCE, TILE)).toBe(true);
  });

  it('offline miss resolves undefined without fetching (never hard-fails)', async () => {
    const { blobs } = newStorage();
    const { fn, calls } = mockFetch();
    const cache = createTileCache({ blobs, fetch: fn });

    const out = await cache.get(SOURCE, TILE, { online: false });
    expect(out).toBeUndefined();
    expect(calls()).toHaveLength(0);
  });

  it('offline hit serves the cached tile', async () => {
    const { blobs } = newStorage();
    const { fn } = mockFetch();
    const cache = createTileCache({ blobs, fetch: fn });

    await cache.get(SOURCE, TILE, { online: true });
    const offline = await cache.get(SOURCE, TILE, { online: false });
    expect(offline).toBeInstanceOf(Blob);
  });

  it('treats a non-2xx response as a miss and does not cache it', async () => {
    const { blobs } = newStorage();
    const fn: FetchFn = async () => ({ ok: false, status: 404, blob: async () => new Blob([]) });
    const cache = createTileCache({ blobs, fetch: fn });

    expect(await cache.get(SOURCE, TILE, { online: true })).toBeUndefined();
    expect(await cache.has(SOURCE, TILE)).toBe(false);
  });

  it('swallows a fetch rejection (offline error) and returns undefined', async () => {
    const { blobs } = newStorage();
    const fn: FetchFn = async () => {
      throw new Error('network down');
    };
    const cache = createTileCache({ blobs, fetch: fn });
    expect(await cache.get(SOURCE, TILE, { online: true })).toBeUndefined();
  });
});

describe('TileCache prefetch', () => {
  it('downloads + caches a batch and reports counts', async () => {
    const { blobs } = newStorage();
    const { fn, calls } = mockFetch();
    const cache = createTileCache({ blobs, fetch: fn });
    const tiles: TileCoord[] = [
      { z: 4, x: 0, y: 0 },
      { z: 4, x: 1, y: 0 },
      { z: 4, x: 0, y: 1 },
    ];

    const r1 = await cache.prefetch(SOURCE, tiles, { online: true });
    expect(r1).toEqual({ requested: 3, fetched: 3, cached: 0, failed: 0 });
    expect(calls()).toHaveLength(3);

    // second run: all present ⇒ all counted as cached, no new fetches
    const r2 = await cache.prefetch(SOURCE, tiles, { online: true });
    expect(r2).toEqual({ requested: 3, fetched: 0, cached: 3, failed: 0 });
    expect(calls()).toHaveLength(3);
  });

  it('offline prefetch fetches nothing and marks misses as failed', async () => {
    const { blobs } = newStorage();
    const { fn, calls } = mockFetch();
    const cache = createTileCache({ blobs, fetch: fn });
    const r = await cache.prefetch(SOURCE, [{ z: 4, x: 9, y: 9 }], { online: false });
    expect(r).toEqual({ requested: 1, fetched: 0, cached: 0, failed: 1 });
    expect(calls()).toHaveLength(0);
  });

  it('reports progress per tile', async () => {
    const { blobs } = newStorage();
    const { fn } = mockFetch();
    const cache = createTileCache({ blobs, fetch: fn });
    const seen: number[] = [];
    await cache.prefetch(
      SOURCE,
      [
        { z: 2, x: 0, y: 0 },
        { z: 2, x: 1, y: 0 },
      ],
      { online: true, onProgress: (done, total) => seen.push(done / total) },
    );
    expect(seen).toEqual([0.5, 1]);
  });
});

describe('TileCache eviction + clear', () => {
  it('evicts oldest entries beyond the bound', async () => {
    const { blobs } = newStorage();
    const { fn } = mockFetch();
    let clock = 1000;
    const cache = createTileCache({ blobs, fetch: fn, maxEntries: 2, now: () => clock });

    for (const x of [0, 1, 2]) {
      clock += 100; // each tile newer than the last
      await cache.get(SOURCE, { z: 5, x, y: 0 }, { online: true });
    }
    // get() does not evict; prefetch/evict do — call evict explicitly.
    const removed = await cache.evict();
    expect(removed).toBe(1);
    expect(await cache.has(SOURCE, { z: 5, x: 0, y: 0 })).toBe(false); // oldest gone
    expect(await cache.has(SOURCE, { z: 5, x: 2, y: 0 })).toBe(true); // newest kept
  });

  it('evicts tiles older than maxAgeMs', async () => {
    const { blobs } = newStorage();
    const { fn } = mockFetch();
    let clock = 0;
    const cache = createTileCache({ blobs, fetch: fn, maxAgeMs: 50, now: () => clock });
    await cache.get(SOURCE, TILE, { online: true });
    clock = 100; // older than 50ms
    expect(await cache.evict()).toBe(1);
    expect(await cache.has(SOURCE, TILE)).toBe(false);
  });

  it('clears all tiles for a source', async () => {
    const { blobs } = newStorage();
    const { fn } = mockFetch();
    const cache = createTileCache({ blobs, fetch: fn });
    await cache.get(SOURCE, TILE, { online: true });
    await cache.clear('osm');
    expect(await cache.has(SOURCE, TILE)).toBe(false);
  });

  it('derives a stable, wrapped cache key', () => {
    expect(tileCacheKey('osm', { z: 3, x: -1, y: 5 })).toBe('osm/3/7/5');
  });
});
