# MVPlanner — Code Audit

Date: 2026-06-02 · Audited revision: `v0.3.0` (`82292de`) · Auditor: orchestrator
Scope: full repository (`src/**`, `test/**`, build/CI, docs, dependencies).

---

## 1. Methodology

This audit combined quantitative sweeps (LOC, markers, casts, dependency/audit,
size, test inventory) with targeted source inspection of the architecture seams,
the unit/format pipeline, persistence, security, the extension system, the build
and CI. Findings below cite concrete files and line anchors. Severities:

- **P0 — High**: correctness/security gap affecting users now.
- **P1 — Medium**: real risk or notable debt; schedule soon.
- **P2 — Low / polish**: quality, size, or process improvements.

---

## 2. Scorecard (overall: strong)

| Dimension          | Rating | Notes                                                                                |
| ------------------ | ------ | ------------------------------------------------------------------------------------ |
| Architecture       | ★★★★★  | Frozen contracts, single-writer store, microservices, worker-hosted MAVLink.         |
| Code hygiene       | ★★★★★  | 0 `TODO/FIXME`, 0 `eslint-disable` in `src/`, 1 `any` (in a comment), strict TS.     |
| Tests              | ★★★★☆  | 174 test files, ~35k test LOC; 1753 unit + 15 live-SITL + perf. Gaps: see §4.3/§5.7. |
| Security           | ★★★★☆  | 0 npm vulns, strict CSP, WebCrypto secret store, egress UI. Gaps: §4.2/§5.4.         |
| Performance/size   | ★★★★☆  | 2.50 MB single-file (budget ≤5 MB); ~270 KB easy win (§5.6).                         |
| Accessibility/i18n | ★★★★☆  | ARIA/keyboard/i18n throughout; rendered axe/contrast browser-deferred (§5.7).        |
| Build/CI           | ★★★☆☆  | Clean single-file build; CI omits the live + perf suites (§4.3).                     |

**Quantitative snapshot**

- Source (non-test): **69,131 LOC across 535 files**; tests: **174 files, 35,223 LOC** (~0.51 ratio).
- Largest areas: `src/ui` 36.7k LOC, `src/mavlink` 9.0k, `src/data`/`src/ext`/`src/geo` ~4–4.4k each.
- `TODO/FIXME/HACK/@ts-ignore`: **0** in `src/`. `eslint-disable` in `src/`: **0**.
- `: any` / `as any`: **1** (a comment in `src/core/store/app-store.ts:150`). `as unknown as`: **12**, all legitimate (env/global shims, JSON dialect imports, worker `self`, `WebSocket`/`RTCPeerConnection` ctor types).
- `npm audit`: **0 vulnerabilities**. Runtime deps: 6 (`solid-js`, `codemirror` + `@codemirror/*`, `uplot`, `idb`). A few dev deps one minor behind (`vite`, `vitest`, `typescript-eslint`); `eslint` 9→10 major available.

---

## 3. Strengths (keep doing this)

- **Frozen-contract discipline** (`src/contracts/**`, `CONTRACTS_VERSION` now `1.6.0`): every cross-module seam is an explicit, versioned, additive-only type. This is the backbone that has kept a 69k-LOC codebase coherent across many feature waves.
- **Single-writer reactive store** (`src/core/store/**`) + **microservice clients** (`src/mavlink/microservices/**`) injected with `{sendMessage,onMessage,getTarget,clock}` — highly testable, no hidden globals.
- **Worker-hosted MAVLink** (`src/workers/mavlink.worker.ts`, `src/mavlink/host/**`) keeps codec/parse off the main thread; codec validated against a pymavlink oracle.
- **Exceptional hygiene**: strict TS (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), no suppressions, no stray `any`. New code consistently adds focused tests.
- **Security posture**: strict CSP (`index.html`), `npm audit` clean, a WebCrypto secret store (`src/core/secrets/**`), and an egress-transparency panel.

---

## 4. P0 — High-priority findings

### 4.1 Unit selection does not reach the Flight HUD / instrument gauges

**Evidence.** `src/ui/screens/flight/flight-screen.tsx:422` mounts
`<InstrumentPanel vehicle={activeVehicle} rc={rcState} t={t} />` with **no `units`
prop**. `src/ui/widgets/gauges/panel.tsx:40` defaults `units: props.units ?? metricUnits`,
and `src/ui/widgets/gauges/units.ts` only ships `metricUnits` (its header comment
says "the imperial counterpart is provided later by T3.7/T3.8 and injected via…"
— that injection was never wired). Nothing in `src/` constructs a non-metric
`UnitHook`.
**Impact.** The primary telemetry display (speed/altitude/climb gauges) renders
**metric regardless of the units setting** — including the new per-quantity
preferences. This is the unresolved core of the recurring "units not applied
everywhere" report; 0.3 fixed the Measure tool but not the instruments.
**Fix.** Build a `UnitHook` from `unitFormatterFor(store.settings)` (the resolver

- facade already exist in `src/core/units/preferences.ts`) and pass it to
  `InstrumentPanel`; reactively recompute on settings change. Audit the HUD widget
  (`src/ui/widgets/hud/**`) for the same omission. Add a test asserting the gauges
  render imperial/per-quantity values when the store says so.

### 4.2 Map API key is persisted in plaintext at rest

**Evidence.** `src/core/store/app-store.ts:52` persists the whole settings slice:
`persistKey` = `JSON.stringify({ settings: s.settings, layout: s.layout })`, and
`settings.mapSource.apiKey` is part of `settings`. The WebCrypto secret store
write-through (`src/App.tsx:430–456`) encrypts a _copy_, and exports redact the
key (`storage-manager`), but the **plaintext key still sits in IndexedDB** via the
generic settings persistence.
**Impact.** Defeats the purpose of the encrypted secret store for the one secret
users actually enter; a local attacker/another origin-sharing context can read it.
(Flagged during the T8.12 security pass; still open.)
**Fix.** Persist a **redacted** settings copy (strip `mapSource.apiKey` before
`persistKey`/write), and treat the secret store as the sole at-rest home for the
key (hydrate the in-memory value from it on boot, which `App.tsx` already does).
Add a test that the persisted KV payload never contains the key.

---

## 5. P1 — Medium-priority findings

### 5.1 CI does not run the live SITL gate or the perf harness

**Evidence.** `.github/workflows/ci.yml` runs `lint → typecheck → test → build →
check:size` only. `test/integration-sitl/**` (the pymavlink↔codec oracle + live
bridge) and `test/perf/**` are excluded from the default `vitest` config and are
**not invoked in CI**; they only run locally/manually.
**Impact.** A regression in the codec wire-format, the bridge, or memory bounds
will pass CI. The project's strongest correctness guarantee is unenforced.
**Fix.** Add a CI job (or nightly) that runs
`npx vitest run --config test/integration-sitl/vitest.config.ts` (it provisions
the `.venv` pymavlink fake vehicle) and the perf suite, gated to not block PRs if
flaky but visible on `main`.

### 5.2 Imported extensions are not actually sandboxed by default

**Evidence.** `createExtensionSystem` (`src/ext/api/**`) supports a trusted/
untrusted runtime selector and a sandbox runtime exists (`src/ext/sandbox/**`),
but no blob-Worker `GuestSpawner` is wired in `src/App.tsx`, so untrusted/imported
extensions fall back to the **in-process trusted runtime** (documented as
browser-deferred).
**Impact.** Third-party/imported extension code runs with first-party trust in
the main realm — the isolation the design intends isn't yet enforced.
**Fix.** Wire a CSP-compatible blob-Worker spawner so `trusted:false` extensions
execute in the sandbox; keep bundled examples trusted. Add an e2e test that an
imported extension cannot reach the main realm.

### 5.3 No top-level LICENSE file

**Evidence.** `NOTICES` (third-party licenses) and `SECURITY.md` exist, the About
screen advertises "local-first / open", but there is **no `LICENSE`** at the repo
root declaring MVPlanner's own license.
**Impact.** Ambiguous redistribution/reuse terms for an otherwise openly-shipped
single-file app.
**Fix.** Add a `LICENSE` (e.g. MIT/Apache-2.0/GPL per intent) and reference it
from `README.md` + the About screen.

### 5.4 (security, also see 4.2) CSP relies on `unsafe-inline` + `unsafe-eval`

**Evidence.** `index.html` CSP includes `script-src 'unsafe-inline' 'unsafe-eval'`
(documented in `SECURITY.md`): `unsafe-inline` for the single-file inlined bundle,
`unsafe-eval` for the first-party scripting console's `AsyncFunction`.
**Impact.** Weakens XSS containment; acceptable tradeoffs for a single-file +
scripting product, but worth periodic review.
**Fix (optional/hardening).** Consider hashing the inlined bundle script
(`'sha256-…'`) instead of `'unsafe-inline'`, and moving the scripting-console
eval into a worker with its own CSP to drop `unsafe-eval` from the document.

### 5.5 Window-sizing / a11y fixes are logic-tested but not pixel-verified

**Evidence.** The 0.3 overflow fix (`.mvp-main { overflow: auto }` + audit) and
the a11y/RTL/contrast posture are unit-tested for logic only; there is **no
Playwright + axe** browser gate. Real gamepad/RC, 60fps render and true-500 MB
log open are also browser-deferred.
**Fix.** Add a Playwright job: axe per screen, contrast across the 4 themes,
keyboard nav, and a short-viewport pass confirming nothing clips (the Plan tool
rail `.mvp-plan__rail` is the flagged risk).

### 5.6 Dialect payload redundancy (~270 KB shippable savings)

**Evidence.** `src/mavlink/dialects/generated/ardupilotmega.json` (346 KB)
_contains_ `common.json` (270 KB); both are bundled. The perf harness already
documents this.
**Impact.** ~270 KB of the 2.5 MB artifact is duplicated dialect data. Not urgent
(well under budget) but the single largest easy size win.
**Fix.** Ship ardupilotmega as the default (it's a superset) and lazy-load
`common` only where a PX4-only context needs it; repoint the microservice
constants that import `commonDialect`.

---

## 6. P2 — Low / polish

- **6.1 Decimal-while-typing** — numeric inputs normalize via `parseFloat` per
  input event (`"1."`→`"1"`). The focus-loss bug was fixed (`<For>`→`<Index>` in
  `src/ui/screens/plan/{fence,rally}-panel.tsx`), but a shared `NumberField`
  (string draft, commit on blur) would resolve decimal typing uniformly.
- **6.2 Hand-maintained extension typings** — `extensions/index.d.ts` is edited by
  hand per example (drift risk vs `extensions/index.js`); generate it or add a
  parity test.
- **6.3 `EXT_API_VERSION` pinned at `1.0.0`** while the app is `0.3.0`
  pre-release (`src/version.ts`); examples declare `^1.0`. Coherent, but document
  the intent (it's the public extension contract) or align it.
- **6.4 SITL test lint noise** — 12 intentional `eslint-disable no-console` in
  `test/integration-sitl/*` keep `npm run lint` from being warning-clean; scope an
  override in `eslint.config.js` for that folder.
- **6.5 Plan persistence is in-memory only** — `createPlanSession`
  (`src/ui/screens/plan/plan-session.ts`) survives tab switches but not reloads;
  persisting the working plan to storage (like settings) would be more robust for
  a planning tool.
- **6.6 Dependency freshening** — bump `vite`/`vitest`/`typescript-eslint` (patch)
  and evaluate `eslint` 9→10 (major) on a branch.

---

## 7. Remediation roadmap (suggested order)

1. **P0 (now):**
   - Bridge gauges/HUD to the unit formatter (4.1) — `flight-screen.tsx`,
     `widgets/gauges/{units.ts,panel.tsx}` + HUD; add an imperial-gauge test.
   - Strip `mapSource.apiKey` from the persisted settings slice (4.2) —
     `core/store/app-store.ts`; add a "no plaintext key in KV" test.
2. **P1 (next):**
   - CI nightly running `integration-sitl` + `perf` (5.1).
   - Wire the blob-Worker sandbox spawner so imports isolate (5.2).
   - Add a root `LICENSE` (5.3).
3. **P2 (scheduled):**
   - Ardupilotmega-only dialect bundle for the ~270 KB win (5.6).
   - Playwright + axe e2e gate for layout/a11y/contrast (5.5).
   - Shared `NumberField`; generated/verified `extensions/index.d.ts`; persist the
     working plan; SITL lint override; dependency bumps.
4. **Hardening (opportunistic):** CSP hash/nonce + worker-eval for the console (5.4).

---

## 8. Appendix — files referenced

- `src/ui/screens/flight/flight-screen.tsx` (gauges mount, line 422)
- `src/ui/widgets/gauges/{units.ts,panel.tsx,register.ts}`
- `src/core/units/preferences.ts` (resolver + formatter facade)
- `src/core/store/app-store.ts` (persistence, line 52)
- `src/App.tsx` (secret write-through, lines ~414–456)
- `index.html`, `SECURITY.md` (CSP)
- `.github/workflows/ci.yml` (CI scope)
- `test/integration-sitl/**`, `test/perf/**` (excluded suites)
- `src/ext/api/**`, `src/ext/sandbox/**` (extension runtime selector)
- `src/mavlink/dialects/generated/{common,ardupilotmega}.json` (size redundancy)
- `extensions/index.{js,d.ts}` (hand-maintained typings)
- `src/ui/screens/plan/plan-session.ts` (in-memory plan persistence)
- `NOTICES` (present), `LICENSE` (missing)
