/**
 * High-level storage facade tying the KV, blob and file backends to a single
 * lazily-opened, versioned IndexedDB database (T0.9; spec plan/07 §7.2). The
 * database is opened on first use; persistent storage (spec plan/07 §7.3) is
 * requested once, guarded by availability, before opening.
 */
import type { BlobStore, FileIo, KvStore } from '../../contracts';
import { createBlobStore } from './blob';
import { createFileIo, type FileIoEnv } from './fileio';
import { createKvStore } from './kv';
import {
  DB_NAME,
  DB_VERSION,
  openStorageDb,
  requestPersistentStorage,
  type StorageDatabase,
} from './schema';

/** Options for {@link createStorage}. */
export interface StorageOptions {
  /** Database name; defaults to {@link DB_NAME}. */
  readonly name?: string;
  /** Schema version; defaults to {@link DB_VERSION}. */
  readonly version?: number;
  /**
   * Request persistent storage before opening (spec plan/07 §7.3). Defaults to
   * `true`; set `false` in tests to avoid touching `navigator.storage`.
   */
  readonly requestPersistence?: boolean;
  /** Injected environment for {@link FileIo} (testing). */
  readonly fileEnv?: FileIoEnv;
}

/** The composed storage foundation surface. */
export interface AppStorage {
  /** Namespaced key/value store. */
  readonly kv: KvStore;
  /** Namespaced blob store. */
  readonly blobs: BlobStore;
  /** Disk open/save with File System Access + fallback. */
  readonly files: FileIo;
  /** Open (and lazily cache) the backing database; resolves the handle. */
  open(): Promise<StorageDatabase>;
  /** Close the backing database (if opened) so it can be re-opened cleanly. */
  close(): Promise<void>;
}

/**
 * Create the storage foundation. Backends share one database that is opened on
 * first use.
 *
 * @param options - Optional database name/version, persistence toggle and file
 *   environment.
 * @returns The composed {@link AppStorage}.
 */
export function createStorage(options: StorageOptions = {}): AppStorage {
  const name = options.name ?? DB_NAME;
  const version = options.version ?? DB_VERSION;
  const wantPersistence = options.requestPersistence ?? true;

  let dbPromise: Promise<StorageDatabase> | undefined;
  const getDb = (): Promise<StorageDatabase> => {
    if (dbPromise === undefined) {
      dbPromise = (async (): Promise<StorageDatabase> => {
        if (wantPersistence) {
          await requestPersistentStorage();
        }
        return openStorageDb(name, version);
      })();
    }
    return dbPromise;
  };

  return {
    kv: createKvStore(getDb),
    blobs: createBlobStore(getDb),
    files: createFileIo(options.fileEnv),
    open: getDb,
    async close(): Promise<void> {
      if (dbPromise !== undefined) {
        const db = await dbPromise;
        db.close();
        dbPromise = undefined;
      }
    },
  };
}
