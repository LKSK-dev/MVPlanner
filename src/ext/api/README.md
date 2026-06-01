# `ext/api` — the `mvp`/`ctx` extension API (T7.3)

The concrete, **semver-locked** implementation of the public extension API
surface. Spec: `plan/06` §6.4 (the full `ctx` surface) / §6.5 (permission model)
/ §6.10 (stability). Contract: `src/contracts/ext-api.ts` (FROZEN `ExtContext` +
`Permission` + `ExtManifest` + `ExtContributes`).

It assembles the frozen `ExtContext` over the **injected real services**, gated
by a single capability map through the T7.2 `PermissionBroker`. It depends on
contracts + the T7.1 host + T7.2 permissions/sandbox; it **imports** the wrapped
services (MAVLink host, microservices, UI shell, map, audit, storage, dialects)
only via injected ports — never their internals.

## Pieces

| File                          | Surface                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------ |
| `ports.ts`                    | `ExtApiServices` — the injected service ports each `ctx.*` group wraps.                    |
| `capability-map.ts`           | `CAPABILITY_MAP` — the authoritative `method → Permission` table (single source of truth). |
| `register.ts`                 | `registerExtApi(broker, deps)` — registers every privileged method on the broker.          |
| `context.ts`                  | `assembleExtContext(deps)` — the typed `ctx` for the trusted in-process runtime.           |
| `locals.ts`                   | guest-local `ctx.events` bus + `ctx.log` sink (unbrokered utilities).                      |
| `system.ts`                   | `createExtensionSystem(deps)` — host + runtime + broker + grants, wired.                   |
| `dts.ts` / `generated-dts.ts` | the bundled `.d.ts` for editor autocomplete (`buildExtApiDts(version)`).                   |

## Capability map (`method → required Permission`)

`registerExtApi` registers one broker handler per row. The broker enforces the
permission, the armed-aware confirm + audit (vehicle-affecting scopes) and the
per-call `net:<host>` egress gate; the handlers do only the args→service wiring.

| `ctx` method(s)                                                                                                                          | `Permission`                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `connection.state` / `connection.on`                                                                                                     | _(ungated)_                         |
| `vehicles.*`, `mavlink.on/latest/rate/requestInterval`, `params.get/fetchAll/onChange`, `mission.download/onCurrent/onReached`, `logs.*` | `telemetry:read`                    |
| `mavlink.send`                                                                                                                           | `mavlink:send`                      |
| `mavlink.loadDialect`                                                                                                                    | `dialect`                           |
| `command.*`                                                                                                                              | `command`                           |
| `params.set`                                                                                                                             | `params:write`                      |
| `mission.upload/clear/setCurrent`                                                                                                        | `mission:write`                     |
| `ui.registerPanel/registerWidget/registerCommand/addMenuItem/confirm`, `theme.register`                                                  | `ui:panel`                          |
| `ui.toast`, `notify.*`                                                                                                                   | `notify`                            |
| `map.*`                                                                                                                                  | `map`                               |
| `storage.get/set`                                                                                                                        | `storage`                           |
| `files.*`                                                                                                                                | `files`                             |
| `net.fetch`                                                                                                                              | `net:<host>` (per-call egress gate) |
| `transports.register`                                                                                                                    | `transport`                         |

`ctx.log` / `ctx.timers` / `ctx.events` / `ctx.onDispose` / `ctx.version` are
**guest-local** (no privilege, and carry functions that cannot cross the RPC
boundary), so they are provided locally, not brokered.

Vehicle-affecting reads vs. writes: reads gate behind `telemetry:read`; writes
carry their own scope and are confirm-gated + audited (origin = extension id).
Optional groups (`map`/`theme`/`logs`/`files`/`net`/`transports`) whose backing
service is absent are simply not registered.

## Two runtimes, one policy

- **Sandboxed (untrusted):** the guest holds only the T7.2 proxy of _granted_
  method names (`capabilitiesFor`); every privileged call RPCs to
  `broker.invoke`, where these handlers run. (Callback/DOM-bearing methods —
  `*.on`, `ui.registerPanel`'s `mount` — cannot cross the structured-clone RPC
  boundary; full guest-side callback bridging is the browser iframe/worker path,
  deferred. The broker registrations + cloneable-arg methods are exercised here.)
- **Trusted (in-process):** `assembleExtContext` builds the typed `ctx` with
  direct service refs (synchronous reads keep their sync signatures) but routes
  every Promise-returning privileged call through the **same broker**, so
  vehicle-affecting confirm/audit + `net` egress gating apply identically. The
  optional `ctx.*` groups are present **iff** their permission is granted.

## `createExtensionSystem(deps)`

The single object App instantiates:

```ts
const system = createExtensionSystem({
  storage,            // KvStore (installs + grants)
  services,           // ExtApiServices (adapt the real services to the ports)
  confirm,            // armed-aware confirm (shell `confirm`)
  audit?, recordEgress?, version?, events?,
  spawn?,             // GuestSpawner → SANDBOX runtime; omit → trusted in-process
  watchdog?, onTerminated?, namespace?, now?,
});

await system.restore();
await system.install({ manifest, code /* or module */ });
await system.setGrants(id, manifest.permissions);  // after the install prompt
await system.activate(id);     // resolves the grant snapshot, then activates
await system.fire('onConnect');
```

`exports`: `{ host, broker, grants, restore, install, setGrants, enable,
disable, uninstall, reload, activate, fire, dispose }`.

## `.d.ts`

`scripts/gen-ext-dts.mjs` bundles the frozen `ctx`/`mvp` type closure
(`transport`→`vehicle`→`mavlink`→`microservices`→`map`→`store`→`ui`→`ext-api`,
which is self-contained) into the checked-in `generated-dts.ts`.
`buildExtApiDts(version)` injects the running version for the scripting console
(T7.4) / API reference (T7.5). Regenerate after a contract change:

```sh
node scripts/gen-ext-dts.mjs
```

## How to test

```sh
export npm_config_cache="$PWD/.npm-cache"
npx vitest run test/unit/ext-api.test.ts
npx eslint src/ext/api test/unit/ext-api.test.ts
```
