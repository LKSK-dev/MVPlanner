/**
 * `data/storage` public surface (impl 02 §2.8; spec plan/07 §7.2). The storage
 * foundation implements the frozen `src/contracts/storage.ts` seams
 * ({@link KvStore}, {@link BlobStore}, {@link FileIo}) over a versioned
 * IndexedDB database with a migration framework and a guarded persistent-storage
 * request. Cross-module consumers import from here, never deep paths.
 */
export type { BlobMeta, BlobStore, FileIo, KvStore } from '../../contracts';

export { createKvStore } from './kv';
export { createBlobStore } from './blob';
export { createFileIo, type FileIoEnv } from './fileio';
export { createStorage, type AppStorage, type StorageOptions } from './storage';
export {
  migrate,
  openStorageDb,
  requestPersistentStorage,
  DB_NAME,
  DB_VERSION,
  KV_STORE,
  BLOB_STORE,
  BLOB_NS_INDEX,
  type BlobRecord,
  type PersistentStorageManagerLike,
  type PersistentStorageNavigatorLike,
  type StorageDatabase,
  type StorageSchema,
} from './schema';
