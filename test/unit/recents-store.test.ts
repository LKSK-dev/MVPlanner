/**
 * RecentsStore tests (App Settings → Recents): record/open/remove/clear,
 * de-dup, entry-count trimming and cached-bytes eviction, over in-memory fakes.
 */
import { describe, expect, it } from 'vitest';
import { createRecentsStore } from '../../src/core/recents';
import { fakeBlobs, fakeKv } from '../helpers';

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

  it('serializes concurrent mutations so the list stays consistent (audit B8)', async () => {
    let id = 0;
    const store = createRecentsStore({
      kv: fakeKv(),
      blobs: fakeBlobs(),
      makeId: () => `id${++id}`,
    });
    // Fire overlapping mutations without awaiting between them.
    const [a, b] = await Promise.all([
      store.record({ kind: 'plan', name: 'same', blob: blobOf(4) }),
      store.record({ kind: 'plan', name: 'same', blob: blobOf(8) }),
    ]);
    expect(a.id).not.toBe(b.id);
    // De-dup by kind+name held even under concurrency: exactly one survives.
    const snap = store.snapshot();
    expect(snap.filter((e) => e.name === 'same')).toHaveLength(1);
    expect(snap[0]?.sizeBytes).toBe(8);
  });

  it('record() never returns cached:true for an entry uncached by budget eviction (audit B8)', async () => {
    const store = createRecentsStore({ kv: fakeKv(), blobs: fakeBlobs(), maxCacheBytes: 100 });
    await store.record({ kind: 'log', name: 'old', blob: blobOf(80) });
    const fresh = await store.record({ kind: 'log', name: 'new', blob: blobOf(80) });
    // The returned entry must agree with the post-eviction list.
    expect(fresh.cached).toBe(store.snapshot().find((e) => e.id === fresh.id)?.cached);
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
