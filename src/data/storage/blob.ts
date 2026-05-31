/**
 * Namespaced blob store ({@link BlobStore}) backed by the `blobs` object store
 * (T0.9; contract `src/contracts/storage.ts`). Each record keeps the blob bytes
 * plus size/type/metadata; `getRange` returns just the requested byte window so
 * the whole blob is never retained in a persistent structure.
 */
import type { BlobMeta, BlobStore } from '../../contracts';
import { BLOB_NS_INDEX, BLOB_STORE, type BlobRecord, type StorageDatabase } from './schema';

/** Clamp `n` into the inclusive range `[lo, hi]`. */
function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(n, hi));
}

/** Fetch a record or throw a descriptive error when the blob is absent. */
async function requireRecord(
  db: StorageDatabase,
  ns: string,
  key: string,
  op: string,
): Promise<BlobRecord> {
  const id: [string, string] = [ns, key];
  const record = await db.get(BLOB_STORE, id);
  if (record === undefined) {
    throw new Error(`BlobStore.${op}: no blob for ns="${ns}", key="${key}"`);
  }
  return record;
}

/** Project a stored record onto the public {@link BlobMeta} shape. */
function toMeta(record: BlobRecord): BlobMeta {
  const meta: BlobMeta = { key: record.key, bytes: record.bytes };
  if (record.meta !== undefined) {
    meta.meta = record.meta;
  }
  return meta;
}

/**
 * Create a {@link BlobStore} over a lazily-resolved database.
 *
 * @param getDb - Resolves the shared {@link StorageDatabase} (opened on demand).
 * @returns A namespaced put / getRange / size / list / del blob store.
 */
export function createBlobStore(getDb: () => Promise<StorageDatabase>): BlobStore {
  return {
    async put(ns: string, key: string, data: Blob, meta?: unknown): Promise<void> {
      const db = await getDb();
      const buffer = await data.arrayBuffer();
      const record: BlobRecord = {
        ns,
        key,
        bytes: buffer.byteLength,
        type: data.type,
        data: buffer,
      };
      if (meta !== undefined) {
        record.meta = meta;
      }
      const id: [string, string] = [ns, key];
      await db.put(BLOB_STORE, record, id);
    },

    /**
     * Read a byte window `[start, end)` (end-exclusive, clamped to the blob
     * size) and return it as a fresh `Uint8Array`. Out-of-range or inverted
     * bounds yield an empty array rather than throwing.
     */
    async getRange(ns: string, key: string, start: number, end: number): Promise<Uint8Array> {
      const record = await requireRecord(await getDb(), ns, key, 'getRange');
      const total = record.bytes;
      const from = clamp(start, 0, total);
      const to = clamp(end, from, total);
      return new Uint8Array(record.data).slice(from, to);
    },

    async size(ns: string, key: string): Promise<number> {
      const record = await requireRecord(await getDb(), ns, key, 'size');
      return record.bytes;
    },

    async list(ns: string): Promise<BlobMeta[]> {
      const db = await getDb();
      const records = await db.getAllFromIndex(BLOB_STORE, BLOB_NS_INDEX, ns);
      return records.map(toMeta);
    },

    async del(ns: string, key: string): Promise<void> {
      const db = await getDb();
      const id: [string, string] = [ns, key];
      await db.delete(BLOB_STORE, id);
    },
  };
}
