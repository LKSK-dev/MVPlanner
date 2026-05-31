# `data/storage` — storage foundation (KV + blobs + files)

Implements the frozen `src/contracts/storage.ts` seams over a **single versioned
IndexedDB database** (via [`idb`](https://github.com/jakearchibald/idb)), plus
disk open/save. Task **T0.9** (spec `plan/07` §7.2/§7.3); module map impl `02`
§2.8.

## Contract

```ts
createStorage(options?: StorageOptions): AppStorage   // kv + blobs + files
createKvStore(getDb): KvStore                         // namespaced get/set/del
createBlobStore(getDb): BlobStore                      // put/getRange/size/list/del
createFileIo(env?): FileIo                              // openForRead / saveAs
openStorageDb(name?, version?): Promise<StorageDatabase>
migrate(db, oldVersion, newVersion): void              // forward-only migrations
requestPersistentStorage(nav?): Promise<boolean>       // guarded, never throws
```

`createStorage` is the high-level entry point: `kv`, `blobs` and `files` share
one database that is **opened lazily on first use**. Before opening, it requests
persistent storage (`navigator.storage.persist()`, guarded) so the OS does not
evict data mid-session (`plan/07` §7.3). All factories accept an injected DB
provider / environment so the pure logic is unit-testable without a real browser
(conventions `00` §0.3).

### `KvStore`

Namespaced `get/set/del` backed by the `kv` object store keyed by the composite
`[ns, key]`. Values are stored as-is (structured-cloned by IndexedDB); the value
type is owned by the caller via the method type parameter. `get` resolves
`undefined` for a miss; `del` is idempotent.

### `BlobStore`

`put/getRange/size/list/del` backed by the `blobs` object store keyed by
`[ns, key]`, with a `by-ns` index powering `list`.

- **`getRange(ns, key, start, end)`** returns a fresh `Uint8Array` for the
  **end-exclusive** window `[start, end)`, clamped to the blob size. Inverted or
  out-of-range bounds yield an empty array. Only the requested window is
  returned, so the whole blob is never retained.
- **`size` / `getRange`** throw a descriptive error for a missing blob; `del` is
  idempotent; `list` returns `[]` for an unknown namespace and includes `meta`
  only when it was provided to `put`.

> **Storage representation:** blob bytes are persisted as an `ArrayBuffer` (plus
> `type`/`bytes`/`meta`), **not** a live `Blob`. This guarantees identical
> round-trips through `structuredClone`/IndexedDB in real browsers _and_ test
> runtimes (some `Blob` polyfills do not survive structured clone). True
> partial-disk reads of very large files are handled by the chunked tlog/log
> paths (T2.10/T6.2), not this foundation.

### `FileIo`

- **`openForRead(accept?)`** uses `showOpenFilePicker` when available, else a
  hidden `<input type=file>`. User cancellation (`AbortError`) resolves
  `undefined`; other errors propagate.
- **`saveAs(data, suggestedName)`** uses `showSaveFilePicker` when available,
  else an `<a download>` blob URL. Cancellation resolves quietly.

Availability is detected at runtime (`createFileIo` reads ambient globals, or an
injected `FileIoEnv` in tests), so one build degrades gracefully across browsers.

### Schema & migrations

One database (`mvplanner`, version `1`). `migrate` is a **forward-only**
framework: it loops from `oldVersion + 1` to the target version, `switch`-ing on
each step so a database opened at any prior version is brought fully up to date.
Each step `break`s (no fall-through, satisfying `noFallthroughCasesInSwitch`);
an unregistered step throws rather than silently leaving the schema incomplete.
To add a migration: bump `DB_VERSION` and add the matching `case` in `migrate`.

## Owned files

- `schema.ts` — DB name/version, store/index name constants, `BlobRecord`,
  `StorageSchema`, `migrate`, `openStorageDb`, `requestPersistentStorage`.
- `kv.ts` — `createKvStore`.
- `blob.ts` — `createBlobStore`.
- `fileio.ts` — `createFileIo` + `FileIoEnv` and File System Access fallbacks.
- `storage.ts` — `createStorage` facade (`AppStorage`).
- `index.ts` — public barrel.

## How to test

```sh
npx vitest run test/unit/storage.test.ts
```

The test imports `fake-indexeddb/auto` to provide IndexedDB under happy-dom and
covers KV CRUD + namespacing, Blob `put/getRange/size/list/del` (+ clamping,
missing-key errors), the versioned schema + index, re-opening the DB without a
migration error (data preserved), the guarded persistent-storage request, and
the File System Access `FileIo` paths (with the `<a download>` fallback). The
`<input type=file>` open fallback is implemented but not unit-tested (it requires
a user gesture).

## Scope note

This task ships the storage **foundation** only. Higher-level consumers — the
reactive store's settings/layout persistence (T0.5), the Storage Manager UI
(T3.7), tile cache (T2.3), tlog chunking (T2.10) — build on these seams in their
own modules and are out of scope here.
