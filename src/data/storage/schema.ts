/**
 * IndexedDB schema, versioning & migration framework for the storage foundation
 * (T0.9; spec plan/07 §7.2). All persisted data lives in one versioned database;
 * opening an older database upgrades it in place via the forward-only steps in
 * {@link migrate}. This module also hosts the guarded persistent-storage request
 * (spec plan/07 §7.3) so the OS does not evict app data mid-session.
 *
 * The contract backends in `src/contracts/storage.ts`
 * ({@link import('../../contracts').KvStore},
 * {@link import('../../contracts').BlobStore}) are layered on top of these
 * object stores in `kv.ts` / `blob.ts`.
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** Default database name. */
export const DB_NAME = 'mvplanner';

/**
 * Current schema version. Bump this when adding a migration step and register a
 * matching `case` in {@link migrate}.
 */
export const DB_VERSION = 1;

/** Namespaced key/value object store name (out-of-line key `[ns, key]`). */
export const KV_STORE = 'kv';

/** Blob object store name (out-of-line key `[ns, key]`). */
export const BLOB_STORE = 'blobs';

/** Index on {@link BlobRecord.ns}; powers `BlobStore.list`. */
export const BLOB_NS_INDEX = 'by-ns';

/**
 * Stored representation of a blob. Raw bytes are kept as an `ArrayBuffer` rather
 * than a `Blob` so the record round-trips through `structuredClone`/IndexedDB
 * identically in real browsers and in test runtimes (some `Blob` polyfills do
 * not survive structured clone). `BlobStore.getRange` slices these bytes and
 * returns only the requested window; it currently loads the full stored record
 * per call before slicing (acceptable for the M0 foundation). True
 * windowed/chunked reads for large logs land later via the chunked tlog/
 * DataFlash paths (T2.10 / T6.2).
 */
export interface BlobRecord {
  /** Namespace (logical bucket). */
  readonly ns: string;
  /** Key within the namespace. */
  readonly key: string;
  /** Byte length of {@link data}. */
  readonly bytes: number;
  /** MIME type carried by the source `Blob` (may be the empty string). */
  readonly type: string;
  /** Raw blob bytes. */
  readonly data: ArrayBuffer;
  /** Optional caller metadata (e.g. a tlog sidecar descriptor). */
  meta?: unknown;
}

/** Typed IndexedDB schema for the storage foundation. */
export interface StorageSchema extends DBSchema {
  kv: {
    key: [string, string];
    value: unknown;
  };
  blobs: {
    key: [string, string];
    value: BlobRecord;
    indexes: { 'by-ns': string };
  };
}

/** Opened, typed storage database handle. */
export type StorageDatabase = IDBPDatabase<StorageSchema>;

/** Create the v1 object stores + indexes on a fresh database. Idempotent. */
function migrateToV1(db: StorageDatabase): void {
  if (!db.objectStoreNames.contains(KV_STORE)) {
    db.createObjectStore(KV_STORE);
  }
  if (!db.objectStoreNames.contains(BLOB_STORE)) {
    const blobs = db.createObjectStore(BLOB_STORE);
    blobs.createIndex(BLOB_NS_INDEX, 'ns');
  }
}

/**
 * Forward-only migration framework. Applies every schema step strictly greater
 * than the database's `oldVersion`, up to `newVersion`, so a database opened at
 * any prior version is brought fully up to date. Each `case` upgrades from
 * `version - 1` to `version` and `break`s (no fall-through), keeping the switch
 * compatible with `noFallthroughCasesInSwitch`. An unhandled step throws rather
 * than silently leaving the schema incomplete.
 *
 * @param db - Database being upgraded (inside the `versionchange` transaction).
 * @param oldVersion - Version last opened by the user (`0` for a fresh DB).
 * @param newVersion - Target version, or `null` when the DB is being deleted.
 */
export function migrate(db: StorageDatabase, oldVersion: number, newVersion: number | null): void {
  const target = newVersion ?? DB_VERSION;
  for (let version = oldVersion + 1; version <= target; version++) {
    switch (version) {
      case 1:
        migrateToV1(db);
        break;
      default:
        throw new Error(`storage: no migration registered for schema version ${version}`);
    }
  }
}

/**
 * Open (creating/upgrading as needed) the storage database. The `upgrade`
 * callback runs {@link migrate}; opening an already-current database performs no
 * upgrade and preserves existing data.
 *
 * @param name - Database name; defaults to {@link DB_NAME}. Tests pass unique
 *   names for isolation.
 * @param version - Schema version; defaults to {@link DB_VERSION}.
 * @returns The opened, typed {@link StorageDatabase}.
 */
export function openStorageDb(
  name: string = DB_NAME,
  version: number = DB_VERSION,
): Promise<StorageDatabase> {
  return openDB<StorageSchema>(name, version, {
    upgrade(db, oldVersion, newVersion) {
      migrate(db, oldVersion, newVersion);
    },
  });
}

/** Minimal structural view of `navigator.storage` for the persistence request. */
export interface PersistentStorageManagerLike {
  readonly persist?: () => Promise<boolean>;
  readonly persisted?: () => Promise<boolean>;
}

/** Minimal structural view of `navigator` for the persistence request. */
export interface PersistentStorageNavigatorLike {
  readonly storage?: PersistentStorageManagerLike;
}

/**
 * Best-effort request for persistent storage so the OS does not evict app data
 * (spec plan/07 §7.3). Guarded by runtime availability: returns `false` (never
 * throws) when `navigator.storage.persist` is unavailable or rejects.
 *
 * @param nav - Optional navigator-like override (injected in tests); defaults to
 *   the ambient `navigator`.
 * @returns Whether storage is now persistent.
 */
export async function requestPersistentStorage(
  nav?: PersistentStorageNavigatorLike,
): Promise<boolean> {
  const navigatorLike =
    nav ?? (globalThis as { navigator?: PersistentStorageNavigatorLike }).navigator;
  const manager = navigatorLike?.storage;
  if (!manager || typeof manager.persist !== 'function') {
    return false;
  }
  try {
    return await manager.persist();
  } catch {
    return false;
  }
}
