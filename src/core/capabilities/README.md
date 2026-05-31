# `core/capabilities` — runtime feature detection

Detects which browser capabilities are available so the app can **degrade
gracefully with clear messaging** across the supported-browser matrix
(spec `plan/01` §1.7). Listed in the module map at impl `02` §2.3.

## Contract

```ts
detectCapabilities(env?: CapabilityEnv): Capabilities  // pure, injectable
detectRealCapabilities(): Capabilities                 // probes real globals
```

`detectCapabilities` is **pure**: it reads only the injected `env` (a minimal
structural view of `navigator`/`window`), never the ambient globals. With no
argument — or with empty mocks — every flag is `false`. This keeps detection
unit-testable with mock globals (conventions `00` §0.3) and lets callers probe
present / absent / partial environments deterministically.

`detectRealCapabilities` is the thin convenience that feeds the real
`globalThis` into `detectCapabilities`. It is safe in window **and** worker
contexts and never throws (a missing slot yields `false`).

### `Capabilities` flags

| Flag                  | Probe                       | Spec                               |
| --------------------- | --------------------------- | ---------------------------------- |
| `webSerial`           | `navigator.serial`          | `01` §1.7                          |
| `webBluetooth`        | `navigator.bluetooth`       | `01` §1.7                          |
| `webUsb`              | `navigator.usb`             | `01` §1.7                          |
| `fileSystemAccess`    | `window.showOpenFilePicker` | `01` §1.7                          |
| `wasm`                | `typeof WebAssembly`        | `02` §2.2                          |
| `secureContext`       | `isSecureContext`           | `02` §2.2                          |
| `offscreenCanvas`     | `typeof OffscreenCanvas`    | `02` §2.6                          |
| `crossOriginIsolated` | `crossOriginIsolated`       | `02` §2.5 (SharedArrayBuffer ring) |
| `webSpeech`           | `speechSynthesis`           | `01` §1.4                          |
| `gamepad`             | `navigator.getGamepads`     | `04` §4.2                          |

Presence (not concrete shape) is what matters for degradation, so each probed
slot is typed `unknown`; `secureContext`/`crossOriginIsolated` are read as
strict booleans.

## Owned files

- `detect.ts` — `Capabilities` type, structural env types, `detectCapabilities`,
  `detectRealCapabilities`.
- `index.ts` — public barrel.

## How to test

```sh
npx vitest run test/unit/capabilities.test.ts
```

Covers an all-present mock (all `true`), an all-absent mock and the no-arg call
(all `false`), a partial mock (mixed), and that `detectRealCapabilities()` runs
without throwing under happy-dom.

## Scope note

This task ships **only detection**. The "reactive store field" mentioned in the
T0.6 WBS card wires a `Capabilities` value into app state; that crosses into
`src/contracts`/`src/core/store` (frozen contracts, not owned here) and is left
for the orchestrator to integrate.
