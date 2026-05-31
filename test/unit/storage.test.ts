import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createFileIo,
  createStorage,
  migrate,
  openStorageDb,
  requestPersistentStorage,
  BLOB_NS_INDEX,
  BLOB_STORE,
  DB_VERSION,
  KV_STORE,
  type AppStorage,
  type StorageDatabase,
} from '../../src/data/storage';

let uid = 0;
/** Unique DB name per call so tests do not share IndexedDB state. */
const dbName = (): string => `mvp-test-${Date.now()}-${uid++}`;

/** Storage bound to a fresh DB with the persistence request disabled. */
function newStorage(): AppStorage {
  return createStorage({ name: dbName(), requestPersistence: false });
}

/** Build a Blob from raw bytes. */
function blobOf(bytes: number[], type = 'application/octet-stream'): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('KvStore', () => {
  it('round-trips typed values and reports undefined for misses', async () => {
    const { kv } = newStorage();
    expect(await kv.get('settings', 'theme')).toBeUndefined();

    await kv.set<{ theme: string; n: number }>('settings', 'prefs', { theme: 'dark', n: 7 });
    const got = await kv.get<{ theme: string; n: number }>('settings', 'prefs');
    expect(got).toEqual({ theme: 'dark', n: 7 });
  });

  it('overwrites on repeated set', async () => {
    const { kv } = newStorage();
    await kv.set('ns', 'k', 'first');
    await kv.set('ns', 'k', 'second');
    expect(await kv.get<string>('ns', 'k')).toBe('second');
  });

  it('deletes a key (idempotently)', async () => {
    const { kv } = newStorage();
    await kv.set('ns', 'k', 123);
    await kv.del('ns', 'k');
    expect(await kv.get('ns', 'k')).toBeUndefined();
    // del on a missing key must not throw.
    await expect(kv.del('ns', 'k')).resolves.toBeUndefined();
  });

  it('isolates identical keys across namespaces', async () => {
    const { kv } = newStorage();
    await kv.set('a', 'shared', 'A');
    await kv.set('b', 'shared', 'B');
    expect(await kv.get<string>('a', 'shared')).toBe('A');
    expect(await kv.get<string>('b', 'shared')).toBe('B');
  });
});

describe('BlobStore', () => {
  it('puts a blob and reports its size', async () => {
    const { blobs } = newStorage();
    await blobs.put('logs', 'a.tlog', blobOf([1, 2, 3, 4, 5]));
    expect(await blobs.size('logs', 'a.tlog')).toBe(5);
  });

  it('reads a clamped, end-exclusive byte range', async () => {
    const { blobs } = newStorage();
    await blobs.put('logs', 'a', blobOf([10, 20, 30, 40, 50]));

    expect(Array.from(await blobs.getRange('logs', 'a', 1, 4))).toEqual([20, 30, 40]);
    // End past the size is clamped.
    expect(Array.from(await blobs.getRange('logs', 'a', 3, 999))).toEqual([40, 50]);
    // Inverted / out-of-range bounds yield an empty slice.
    expect(Array.from(await blobs.getRange('logs', 'a', 4, 2))).toEqual([]);
    expect(Array.from(await blobs.getRange('logs', 'a', 99, 100))).toEqual([]);
  });

  it('lists blobs in a namespace with metadata, scoped per namespace', async () => {
    const { blobs } = newStorage();
    await blobs.put('logs', 'a', blobOf([1, 2]), { kind: 'tlog' });
    await blobs.put('logs', 'b', blobOf([1, 2, 3]));
    await blobs.put('tiles', 'z', blobOf([9]));

    const listed = (await blobs.list('logs')).sort((x, y) => x.key.localeCompare(y.key));
    expect(listed).toEqual([
      { key: 'a', bytes: 2, meta: { kind: 'tlog' } },
      { key: 'b', bytes: 3 },
    ]);
    expect((await blobs.list('tiles')).map((m) => m.key)).toEqual(['z']);
    expect(await blobs.list('empty-ns')).toEqual([]);
  });

  it('deletes a blob (idempotently) and removes it from listings', async () => {
    const { blobs } = newStorage();
    await blobs.put('logs', 'a', blobOf([1, 2, 3]));
    await blobs.del('logs', 'a');
    expect(await blobs.list('logs')).toEqual([]);
    await expect(blobs.del('logs', 'a')).resolves.toBeUndefined();
  });

  it('throws on size/getRange for a missing blob', async () => {
    const { blobs } = newStorage();
    await expect(blobs.size('logs', 'nope')).rejects.toThrow(/no blob/);
    await expect(blobs.getRange('logs', 'nope', 0, 1)).rejects.toThrow(/no blob/);
  });
});

describe('schema + migrations', () => {
  it('creates the versioned stores + index on first open', async () => {
    const name = dbName();
    const db = await openStorageDb(name, DB_VERSION);
    try {
      expect(db.version).toBe(DB_VERSION);
      expect(db.objectStoreNames.contains(KV_STORE)).toBe(true);
      expect(db.objectStoreNames.contains(BLOB_STORE)).toBe(true);
      const tx = db.transaction(BLOB_STORE);
      expect(tx.store.indexNames.contains(BLOB_NS_INDEX)).toBe(true);
      await tx.done;
    } finally {
      db.close();
    }
  });

  it('throws for a schema step with no registered migration', () => {
    // migrate() is the forward-only entry point run inside the upgrade
    // transaction. Stepping to a version past DB_VERSION has no matching `case`,
    // so the default branch throws rather than silently leaving the schema
    // incomplete (which would abort the IndexedDB upgrade).
    expect(() => migrate({} as unknown as StorageDatabase, DB_VERSION, DB_VERSION + 1)).toThrow(
      /no migration registered/,
    );
  });

  it('keeps the migrated schema + data when re-opening the same database', async () => {
    const name = dbName();

    const first = await openStorageDb(name, DB_VERSION);
    await first.put(KV_STORE, { kept: true }, ['ns', 'k']);
    first.close();

    // Re-opening at the same version must run cleanly with no upgrade error and
    // preserve both the schema and previously-written data.
    const second = await openStorageDb(name, DB_VERSION);
    try {
      expect(second.version).toBe(DB_VERSION);
      expect(second.objectStoreNames.contains(KV_STORE)).toBe(true);
      expect(second.objectStoreNames.contains(BLOB_STORE)).toBe(true);
      expect(await second.get(KV_STORE, ['ns', 'k'])).toEqual({ kept: true });
    } finally {
      second.close();
    }
  });
});

describe('requestPersistentStorage', () => {
  it('returns false when persistence is unavailable', async () => {
    expect(await requestPersistentStorage({})).toBe(false);
    expect(await requestPersistentStorage({ storage: {} })).toBe(false);
  });

  it('reflects the persist() result', async () => {
    expect(
      await requestPersistentStorage({ storage: { persist: () => Promise.resolve(true) } }),
    ).toBe(true);
    expect(
      await requestPersistentStorage({ storage: { persist: () => Promise.resolve(false) } }),
    ).toBe(false);
  });

  it('returns false (never throws) when persist() rejects', async () => {
    expect(
      await requestPersistentStorage({
        storage: { persist: () => Promise.reject(new Error('blocked')) },
      }),
    ).toBe(false);
  });
});

describe('FileIo', () => {
  it('falls back to an <input type=file> for openForRead and resolves the chosen file', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'picked.bin', {
      type: 'application/octet-stream',
    });
    let input: HTMLInputElement | undefined;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag as 'input');
      if (tag === 'input') {
        input = el as HTMLInputElement;
        (el as HTMLInputElement).click = () => {};
      }
      return el;
    });

    // No showOpenFilePicker injected and none on the ambient global, so
    // openForRead takes the DOM <input> fallback.
    const files = createFileIo({});
    const promise = files.openForRead(['.bin']);
    // Simulate the user selecting a file.
    Object.defineProperty(input!, 'files', { value: [file], configurable: true });
    input!.dispatchEvent(new Event('change'));

    const result = await promise;
    expect(result?.name).toBe('picked.bin');
    expect(result?.blob).toBe(file);
  });

  it('resolves undefined when the <input> fallback is cancelled', async () => {
    let input: HTMLInputElement | undefined;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag as 'input');
      if (tag === 'input') {
        input = el as HTMLInputElement;
        (el as HTMLInputElement).click = () => {};
      }
      return el;
    });

    const files = createFileIo({});
    const promise = files.openForRead();
    input!.dispatchEvent(new Event('cancel'));
    expect(await promise).toBeUndefined();
  });

  it('opens via the File System Access API when available', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'mission.plan', {
      type: 'application/json',
    });
    const showOpenFilePicker = vi.fn(async () => [
      {
        getFile: async () => file,
        createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      },
    ]);
    const files = createFileIo({ showOpenFilePicker });

    const result = await files.openForRead(['.plan', 'application/json']);
    expect(result?.name).toBe('mission.plan');
    expect(result?.blob).toBe(file);
    expect(showOpenFilePicker).toHaveBeenCalledOnce();
  });

  it('returns undefined when the open picker is cancelled', async () => {
    const files = createFileIo({
      showOpenFilePicker: async () => {
        throw new DOMException('cancelled', 'AbortError');
      },
    });
    expect(await files.openForRead()).toBeUndefined();
  });

  it('rethrows non-abort errors from the open picker', async () => {
    const files = createFileIo({
      showOpenFilePicker: async () => {
        throw new Error('disk fault');
      },
    });
    await expect(files.openForRead()).rejects.toThrow('disk fault');
  });

  it('saves via the File System Access API when available', async () => {
    let written: Blob | undefined;
    let closed = false;
    const files = createFileIo({
      showSaveFilePicker: async () => ({
        getFile: async () => new File([], 'x'),
        createWritable: async () => ({
          write: async (d: Blob) => {
            written = d;
          },
          close: async () => {
            closed = true;
          },
        }),
      }),
    });

    const blob = blobOf([7, 8, 9]);
    await files.saveAs(blob, 'out.bin');
    expect(written).toBe(blob);
    expect(closed).toBe(true);
  });

  it('resolves quietly when the save picker is cancelled', async () => {
    const files = createFileIo({
      showSaveFilePicker: async () => {
        throw new DOMException('cancelled', 'AbortError');
      },
    });
    await expect(files.saveAs(blobOf([1]), 'x.bin')).resolves.toBeUndefined();
  });

  it('falls back to an <a download> blob URL when the save picker is absent', async () => {
    const createObjectURL = vi.fn(() => 'blob:fake-url');
    const revokeObjectURL = vi.fn();
    const clickSpy = vi.fn();
    let anchor: HTMLAnchorElement | undefined;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag as 'a');
      if (tag === 'a') {
        anchor = el as HTMLAnchorElement;
        (el as HTMLAnchorElement).click = clickSpy;
      }
      return el;
    });

    // No showSaveFilePicker injected and none on the ambient (happy-dom) global,
    // so saveAs takes the DOM fallback.
    const files = createFileIo({ createObjectURL, revokeObjectURL });
    await files.saveAs(blobOf([1, 2, 3]), 'download.bin');

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();
    // The object URL is revoked on a later macrotask (not synchronously after
    // click()) so large downloads aren't truncated on Firefox/Safari.
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
    expect(anchor?.download).toBe('download.bin');
    expect(anchor?.getAttribute('href')).toBe('blob:fake-url');
  });
});
