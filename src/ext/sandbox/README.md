# `ext/sandbox` — isolated extension runtime (T7.2)

Runs untrusted extension code in an **isolated realm** and brokers every
privileged call through the `ext/permissions` `PermissionBroker`. Spec:
`plan/06` §6.6 (sandbox & isolation); `plan/08` §8.3 ("no eval of untrusted code
in the main realm"). Implements the T7.1 `ExtensionRuntime` seam
(`load(record) → LoadedExtension`), so the `ExtensionHost` drives a sandboxed
extension exactly like the in-process one — **no host changes**.

## Architecture

```
 main thread (host)                         isolated realm (guest)
 ┌──────────────────────────┐   RPC over    ┌──────────────────────────┐
 │ PermissionBroker         │ ◀───────────▶ │ ctx PROXY (granted only)  │
 │  broker.invoke(...)      │  MessagePort/ │  ctx.command.arm(...) ────┼─▶ broker.invoke
 │ SandboxWatchdog          │   Worker      │  module.activate(ctx)     │
 └──────────────────────────┘               └──────────────────────────┘
            createSandboxRuntime                    startSandboxGuest
```

- The guest holds **no** real service client — only a `ctx` proxy rebuilt from
  the _granted_ method names (`broker.capabilitiesFor`). Each privileged method
  posts a `broker.invoke` RPC to the host. Ungranted methods are **absent** from
  the proxy (spec §6.5).
- The host bridges `broker.invoke` RPCs to the `PermissionBroker`; broker/handler
  errors marshal back as a rejected RPC — they never crash the host.
- A `SandboxWatchdog` (heartbeat deadman timer) `terminate()`s a runaway guest.
- A guest fault (eval error / `activate` throw) rejects the host's
  `activate` RPC, so the host marks the extension `'error'` (T7.1 isolation).

## Transport seam (`GuestSpawner`)

`createSandboxRuntime` is decoupled from _how_ the guest realm is created:

- **In-process** (`createInProcessSpawner`) — an in-thread `MessageChannel` with
  the guest bootstrap on the far port. **No real Worker**, so the broker + proxy
  round-trip is fully unit-testable. Defaults to running the `module` carried on
  the load record (mirroring the T7.1 in-process runtime); pass a custom
  `evaluate` to drive a different module.
- **Real Worker** — eval of the persisted `code` string in a CSP-compatible
  inline (blob / `?worker&inline`) Worker. **Browser/e2e-deferred**, like the
  MAVLink host worker: it needs `import()` of untrusted code under strict CSP,
  which is exercised in the browser, not the node unit harness. The seam is in
  place (`GuestSpawner`); only the spawner implementation is deferred.

## Public surface

```ts
createSandboxRuntime({ broker, spawn, watchdog?, onTerminated? }): ExtensionRuntime
createInProcessSpawner({ evaluate?, heartbeatMs? }): GuestSpawner
startSandboxGuest({ endpoint, evaluate, heartbeatMs?, timers? }): { stop() }
buildGuestCtx(methods, call): SandboxCtx           // nested proxy from dotted names
new SandboxWatchdog({ timeoutMs, onTimeout, setTimer?, clearTimer? })
// protocol: GUEST_INIT / GUEST_ACTIVATE / GUEST_DEACTIVATE / BROKER_INVOKE / HOST_HEARTBEAT
```

`evaluate(input) → GuestModule` is the swap point: in-process returns a
pre-provided module; the real Worker evals `input.code`. The bootstrap logic is
identical for both.

## Watchdog

Heartbeat deadman timer: the guest should `HOST_HEARTBEAT` at least every
`timeoutMs`; an overdue beat trips `onTimeout` **once** (wired to `terminate()`).
A guest spinning in a tight CPU loop never sends a heartbeat, so it is
terminated rather than wedging the host. Timer hooks are injectable for
deterministic tests. (In single-thread in-process mode a real CPU loop blocks
the thread, so true runaway detection is meaningful only with a real Worker —
the unit test exercises the watchdog primitive + the runtime's terminate path.)

## Note: ignored host `ctx`

The `ExtContext` the host passes to `LoadedExtension.activate` is **ignored** in
sandbox mode — it cannot cross the worker boundary. The privileged surface is
the broker, reached via the in-guest proxy; T7.3 registers concrete handlers on
the broker. The full typed `ExtContext` for the _trusted/in-process_ path is
T7.3's concern.

## Owned files

`proxy.ts` (granted-only `ctx` proxy) · `protocol.ts` (RPC method names +
narrowers) · `guest.ts` (`startSandboxGuest`) · `watchdog.ts` ·
`transport.ts` (`GuestSpawner` + in-process spawner) · `runtime.ts`
(`createSandboxRuntime`) · `index.ts` (barrel).

## Residual risks (real-Worker / browser-deferred)

- **Real-Worker eval under CSP** — evaluating the `code` string in a blob/inline
  Worker must satisfy the strict single-file CSP (`plan/08` §8.3, finalised in
  **T8.12**). `import()` of a blob URL vs `new Function` vs module Worker is a
  CSP-dependent choice to settle when the spawner is implemented in-browser.
- **Sandboxed-iframe (DOM) extensions** — extensions needing DOM/canvas
  (`plan/06` §6.6 "sandboxed iframe when DOM/canvas is needed") are **deferred**;
  only the no-DOM Worker isolation model is built here. The `GuestSpawner` seam
  can host an iframe transport later.

## How to test

```sh
export npm_config_cache="$PWD/.npm-cache"
npx vitest run test/unit/ext-sandbox*.test.ts
npx eslint src/ext/sandbox test/unit/ext-sandbox*.test.ts
```
