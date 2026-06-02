/**
 * RecentsStore tests (App Settings → Recents): record/open/remove/clear,
 * de-dup, entry-count trimming and cached-bytes eviction, over in-memory fakes.
 */
import { describe, expect, it } from 'vitest';
import { createRecentsStore } from '../../src/core/recents';
import type { BlobStore, KvStore } from '../../src/contracts';

function fakeKv(): KvStore {
  const map = new Map<string, unknown>();
  return {
    get: async <T>(ns: string, key: string): Promise<T | undefined> =>
      map.get(`${ns}/${key}`) as T | undefined,
    set: async <T>(ns: string, key: string, v: T): Promise<void> => {
      map.set(`${ns}/${key}`, v);
    },
    del: async (ns: string, key: string): Promise<void> => {
      map.delete(`${ns}/${key}`);
    },
  };
}

function fakeBlobs(): BlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    put: async (ns, key, data): Promise<void> => {
      map.set(`${ns}/${key}`, new Uint8Array(await data.arrayBuffer()));
    },
    getRange: async (ns, key, start, end): Promise<Uint8Array> => {
      const d = map.get(`${ns}/${key}`);
      if (d === undefined) throw new Error('missing');
      return d.slice(start, end);
    },
    size: async (ns, key): Promise<number> => map.get(`${ns}/${key}`)?.byteLength ?? 0,
    list: async (): Promise<never[]> => [],
    del: async (ns, key): Promise<void> => {
      map.delete(`${ns}/${key}`);
    },
  };
}

function blobOf(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

describe('createRecentsStore', () => {
  it('records, caches and re-opens content', async () => {
    let id = 0;
    const store = createRecentsStore({
      kv: fakeKv(),
      blobs: fakeBlobs(),
      now: () => 1000,
      makeId: () => `id${++id}`,
    });
    await store.record({ kind: 'plan', name: 'a.plan', blob: new Blob(['hello']) });
    const entry = store.snapshot()[0];
    expect(entry?.name).toBe('a.plan');
    expect(entry?.cached).toBe(true);
    const opened = await store.open(entry!.id);
    expect(await opened?.blob.text()).toBe('hello');
  });

  it('de-dups by kind+name (newest wins)', async () => {
    const store = createRecentsStore({ kv: fakeKv(), blobs: fakeBlobs() });
    await store.record({ kind: 'log', name: 'x.bin', blob: blobOf(10) });
    await store.record({ kind: 'log', name: 'x.bin', blob: blobOf(20) });
    expect(store.snapshot().filter((e) => e.name === 'x.bin')).toHaveLength(1);
    expect(store.snapshot()[0]?.sizeBytes).toBe(20);
  });

  it('trims to maxEntries (oldest dropped)', async () => {
    const store = createRecentsStore({ kv: fakeKv(), blobs: fakeBlobs(), maxEntries: 2 });
    await store.record({ kind: 'plan', name: 'a', blob: blobOf(1) });
    await store.record({ kind: 'plan', name: 'b', blob: blobOf(1) });
    await store.record({ kind: 'plan', name: 'c', blob: blobOf(1) });
    expect(store.snapshot().map((e) => e.name)).toEqual(['c', 'b']);
  });

  it('uncaches oldest when over the cache-bytes budget', async () => {
    const store = createRecentsStore({ kv: fakeKv(), blobs: fakeBlobs(), maxCacheBytes: 100 });
    await store.record({ kind: 'log', name: 'old', blob: blobOf(80) });
    await store.record({ kind: 'log', name: 'new', blob: blobOf(80) });
    const snap = store.snapshot();
    expect(snap.find((e) => e.name === 'new')?.cached).toBe(true);
    expect(snap.find((e) => e.name === 'old')?.cached).toBe(false);
  });

  it('removes and clears', async () => {
    const store = createRecentsStore({ kv: fakeKv(), blobs: fakeBlobs() });
    const e = await store.record({ kind: 'param', name: 'p.param', blob: blobOf(5) });
    await store.remove(e.id);
    expect(store.snapshot()).toHaveLength(0);
    await store.record({ kind: 'param', name: 'q.param', blob: blobOf(5) });
    await store.clear();
    expect(store.snapshot()).toHaveLength(0);
  });

  it('hydrates from persistence on load', async () => {
    const kv = fakeKv();
    const blobs = fakeBlobs();
    const a = createRecentsStore({ kv, blobs });
    await a.record({ kind: 'tlog', name: 't.tlog', blob: blobOf(3) });
    const b = createRecentsStore({ kv, blobs });
    await b.load();
    expect(b.snapshot()[0]?.name).toBe('t.tlog');
  });
});
