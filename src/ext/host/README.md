# `ext/host` — extension host / manager (T7.1)

The host owns the **extension lifecycle**: manifest validation, install/import,
persistence, lazy activation, hot reload, dispose tracking, and fault isolation.
Spec: `plan/06` §6.2 (package format) / §6.3 (lifecycle); contract
`src/contracts/ext-api.ts` (`ExtManifest`, `Permission`, `ExtContext`).

It is **not** the sandbox/permission broker (that's **T7.2**) and **not** the
`mvp`/`ctx` API implementation (that's **T7.3**). The host is structured around
two swap seams so those tasks plug in without touching it:

| Seam     | Type                                              | T7.1 (here)                                                    | Later                                                                |
| -------- | ------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| Runtime  | `ExtensionRuntime.load(record) → LoadedExtension` | trivial **in-process**, eval-free (runs a pre-provided module) | **T7.2** sandboxed Worker/iframe runtime (eval of the `code` string) |
| Context  | `ContextFactory(input) → ExtContext`              | test fake                                                      | **T7.3** real permission-brokered `ExtContext`                       |
| Watchdog | `Watchdog.watch(id) → stop`                       | no-op (optional)                                               | **T7.2** CPU/loop watchdog                                           |

## Public surface

```ts
new ExtensionHost({ storage, runtime, createContext, now?, watchdog?, namespace? })

host.restore()                       // hydrate from KvStore at startup
host.install(source): ExtState       // validate → persist → (enabled, lazy)
host.list() / host.get(id)
host.enable(id) / host.disable(id)   // disable deactivates if active
host.uninstall(id)                   // deactivate + remove + clear its KV
host.reload(id, source?)             // hot reload: deactivate → swap → reactivate
host.fireActivationEvent(event)      // lazily activate matching enabled exts
host.activate(id) / host.deactivate(id)
host.extStorage(id): ExtKvStore      // per-extension scoped KV (the ctx.storage seam)

// Helpers
parseManifest(input) / isApiVersionCompatible(range, current?)
satisfiesRange(version, range) / parseSemVer(v)
deriveActivationEvents(manifest)
createInProcessRuntime()
DisposeRegistry
```

### `InstallSource`

```ts
{ manifest?, code?, module?, activationEvents?, enabled? }
```

The host takes the **code string + parsed manifest** (fetching files/drag/URL is
the UI's job). The in-process runtime needs a `module` object
(`{ manifest, activate?, deactivate? }`); the sandboxed runtime (T7.2) will eval
the persisted `code`. If `manifest` is omitted it is read from `module.manifest`
(the single-file `.mvpext.js` form). Manifest is validated by `parseManifest` and
its `apiVersion` range is checked against `EXT_API_VERSION`.

## Manifest & semver

`parseManifest` narrows untrusted `unknown` into the frozen `ExtManifest`,
throwing `ExtManifestError` with a clear message on any malformed field (missing
`id`/`name`/`version`/`apiVersion`, bad permission scope, non-semver version,
etc.). `net:<host>` permissions are accepted by prefix.

`semver.ts` is a tiny dependency-free range matcher: exact, `*`/x-range, caret
(`^`), tilde (`~`), and space-separated AND comparators (`>= <= > < =`). `||`
ranges are **not** supported. Ranges compare on the `major.minor.patch` core
only — a version's prerelease tag is ignored — so the pre-release host API
`1.0.0-pre` behaves like `1.0.0` and `^1.0` extensions still load.

## Activation events (lazy)

The frozen `ExtManifest` has no `activationEvents` field, so the host owns this
metadata. Callers fire events and the host activates each enabled,
not-yet-active, non-errored extension on first match:

- `onStartup`, `onConnect`, `onScreen:<id>`, `onCommand:<id>`, `onMessage:<NAME>`

Events are supplied explicitly in `InstallSource.activationEvents` or derived
from `contributes` (`deriveActivationEvents`): one `onCommand:<id>` per
contributed command; `onStartup` when panels are contributed; `onStartup` as the
fallback.

## Dispose registry

Each activation gets a `DisposeRegistry`. The `ctx` (T7.3) routes
`ctx.onDispose(fn)` and tracked timers (`ctx.timers`) into it via
`add` / `setInterval` / `raf`. On deactivate / disable / uninstall / reload the
registry runs every cleanup **once, LIFO, isolating individual faults**, so
there are no leaks. `LoadedExtension.dispose()` is the separate runtime-level
teardown (terminating a worker/iframe in T7.2).

## Error isolation

A throwing `activate`/`deactivate` (or a runtime `load` failure) is caught: the
extension is marked `status: 'error'` (paused) with the message in `state.error`,
its dispose registry is torn down, and the host never throws/crashes. An errored
extension is **not** re-activated by further events until `reload`/`enable`.

## Persistence

Uses the injected `KvStore` under namespace `namespace` (default `'ext'`):

- `index` → `string[]` of installed ids
- `record:<id>` → `{ manifest, code, enabled, activationEvents, installedAt, updatedAt }`
- `<namespace>.data.<id>` → the per-extension KV sub-namespace (via `extStorage`,
  with a tracked key index so `uninstall` can `clear()` it)

Only serializable config is persisted (not live modules or runtime status);
status is recomputed from `enabled` on `restore`. After a reload of the app the
in-process runtime has no module, so activating a restored record yields a clear
`'error'` until `reload(id, { module })` — the sandboxed runtime (T7.2) re-evals
`code` instead.

## Owned files

- `errors.ts` — `ExtManifestError`, `toErrorMessage`.
- `semver.ts` — tiny range matcher (`satisfiesRange`, `parseSemVer`).
- `manifest.ts` — `parseManifest`, `isApiVersionCompatible`.
- `dispose.ts` — `DisposeRegistry`.
- `runtime.ts` — `ExtensionRuntime`/`LoadedExtension`/`ExtModule` seam + `createInProcessRuntime`.
- `activation.ts` — `ActivationEvent`, `deriveActivationEvents`.
- `storage.ts` — `ExtKvStore`, `createExtKvStore`.
- `host.ts` — `ExtensionHost` + its types.
- `index.ts` — public barrel.

## How to test

```sh
export npm_config_cache="$PWD/.npm-cache"
npx vitest run test/unit/ext-host*.test.ts
npx eslint src/ext/host test/unit/ext-host*.test.ts
```

## Scope note

T7.1 ships the host + a trivial in-process runtime so the lifecycle is fully
testable. The sandbox + permission broker (**T7.2**), the real `ExtContext`
(**T7.3**), scripting console (**T7.4**), and example extensions (**T7.6**) build
on these seams in their own modules.
