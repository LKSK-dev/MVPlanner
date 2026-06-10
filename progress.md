# Progress

# Structural move — settings models → ui/shell/appsettings (worker, 2026-06-10)

Status: COMPLETE. Behavior-neutral structural refactor; full gate green.

## New layout

- `src/ui/shell/appsettings/storage-manager.ts` (← `ui/screens/config/settings/storage-manager.ts`)
- `src/ui/shell/appsettings/network/{index.ts,network-section.tsx,egress-log.ts,settings.css,README.md}` (← `ui/screens/config/settings/network/**` + `settings/settings.css`)
- `src/ui/shell/appsettings/network/messages.ts` (← `ui/screens/config/settings/messages.ts`, pruned; exports renamed `SETTINGS_MESSAGES`/`registerSettingsMessages` → `NETWORK_MESSAGES`/`registerNetworkMessages` — grep: zero external consumers). i18n side-effect preserved: `network/index.ts` does `import './messages'`; the appsettings barrel re-exports `./network`, and the i18n-completeness glob (`src/**/messages.ts`) still matches it.
- `src/ui/screens/config/settings/` DELETED (incl. dead `preview.ts` — verified `buildPreview|PREVIEW_SAMPLE|SettingsPreview` had zero consumers outside its own barrel — and `index.ts` + `README.md`).
- `ui/shell/appsettings/index.ts` now re-exports the storage-manager + network surfaces (App.tsx + config/register.tsx consume via this barrel; no import cycle — shell barrel/sim do not import appsettings).

## i18n keys pruned

- messages.ts had 60 `settings.*` keys; 14 live `settings.network.*` kept (13 used in network-section.tsx + `settings.network.links.active` in App.tsx); **46 dead keys deleted** (region/section/units/coord/theme/language/audio/confirm/map/telemetry/preview/storage groups). Verified per-key with quote-anchored grep over src/test/extensions (earlier non-anchored "live" hits were `appsettings.*` substring false positives); no dynamic `settings.\${…}`/concatenation patterns exist.

## Importer updates

- `appsettings/context.ts`, `sections/general.tsx` (+ fixed stale settings-screen.tsx comment), `sections/maps.tsx` → local `./storage-manager` / `./network`.
- `config/register.tsx`: `buildStorageManager` stays; imports `browserStorageEstimate` + `StorageManagerDeps` from `'../../shell/appsettings'`; merged its duplicated doc comment.
- `config/index.ts`: dropped the `./settings` re-export block (grep: no consumers of those re-exports remained); `config/README.md` updated.
- `src/App.tsx`: egress/network imports moved to the appsettings barrel; inspector now via the `ui/widgets/inspector` barrel (exports `registerInspector` + `InspectorSource` — verified) instead of deep `inspector/register`/`inspector/types`; kept the documented deep `inspector.css` import.
- Tests: `settings-storage.test.ts` → renamed `appsettings-storage-manager.test.ts` (imports `appsettings/storage-manager`); `egress-network.test.ts` → `appsettings/network`; `appsettings-general/maps` + `config-screen` type imports updated; removed a pre-existing unused `UiRegistry` import warning in appsettings-general.test.ts. (`docs/security-checklist.md` reference to egress-network.test.ts unchanged — file keeps its name.)

## Validation (full gate)

- `npm run typecheck` ✓ · `npm test` ✓ 175 files / 1849 tests · `npm run lint` ✓ (0 problems) · `npm run format` ✓ (no rewrites) · `npm run build` ✓ (2.53 MB single-file, CSP present). Note: one transient typecheck failure observed mid-run came from the sibling worker's in-flight `ui/widgets/map` edits, resolved on their side before the final gate.
- The earlier note below about general.tsx:14's stale comment is now resolved (fixed in this pass).

---

## Status

Done — setup/config/logs/sim de-dup + dead-code refactor (worker)

## Tasks

- [x] TASK 1: swapped 11 local `type TFn` declarations to `import type { TFn } from '<rel>/core/i18n'` (re-exported via `export type { TFn };` where previously exported):
  - sim/install-prompt.tsx, sim/controller.ts, sim/extensions-manager.tsx, sim/dev-hub.tsx, sim/register.tsx
  - logs/logs-screen.tsx, logs/register.tsx, logs/series-picker.tsx, logs/playback/playback.tsx
  - setup/framework/types.ts
  - config/settings/network/network-section.tsx
  - (settings-screen.tsx's TFn/ConfirmFn/formatBytes not swapped — file deleted in TASK 2; its formatBytes verified byte-identical to canonical core/units impl)
- [x] TASK 2: verified + deleted legacy SettingsScreen:
  - Verified via grep: outside config/settings/, `SettingsScreen|createSettingsPanel|SETTINGS_PANEL_ID` appeared only in config/index.ts (re-export), config-screen.tsx header comment, and test/unit/settings-screen.test.ts (pure SettingsScreen render test).
  - DELETED: settings-screen.tsx, settings/register.tsx, test/unit/settings-screen.test.ts; removed their barrel lines from settings/index.ts and config/index.ts; cleaned stale comments in config-screen.tsx + both READMEs + config-screen.test.ts header.
  - KEPT: preview.ts, storage-manager.ts, network/\*\*, messages.ts, settings-storage.test.ts (tests storage-manager only — still used).
  - KEPT settings.css: import-orphaned, BUT its `mvp-settings__*` classes are used by the surviving NetworkSection (rendered in the App Settings pane; previously styled transitively via the deleted screen's import). Now imported explicitly from network-section.tsx — deleting it would have changed rendering.

## Files Changed

- Modified: sim/{install-prompt,extensions-manager,dev-hub,register}.tsx, sim/controller.ts, logs/{logs-screen,register,series-picker}.tsx, logs/playback/playback.tsx, setup/framework/types.ts, config/settings/network/network-section.tsx, config/{index.ts,config-screen.tsx,README.md}, config/settings/{index.ts,README.md}, test/unit/config-screen.test.ts
- Deleted: config/settings/settings-screen.tsx, config/settings/register.tsx, test/unit/settings-screen.test.ts

## Notes

- Validation: vitest (config-screen, settings-storage, appsettings-general, logs-screen → 39 passed; plus setup/sim/ext/logs-playback/egress sweep → 239 passed), eslint clean on all four owned dirs, `tsc --noEmit` clean.
- Stale comment in src/ui/shell/appsettings/sections/general.tsx:14 still references the deleted settings-screen.tsx path — outside this worker's owned dirs, left for the shell owner.

---

# Test de-dup — test/unit/[m-z]\*.test.ts (worker, 2026-06-10)

Status: COMPLETE. 26 files modified; vitest 26/26 files (203 tests) green; eslint clean.

## Swapped to `../helpers` (26 files, net −224 lines; 264 deletions / 40 insertions)

- settle only: map-widget, messages-widget, msg-sender-widget, param-workbench, paramgrid-widget, plotter-widget, quickwatch-widget, setup-battery-widget, setup-failsafe, setup-frame-widget, setup-framework-widget, setup-modes-widget, setup-motors-widget, setup-screen, tuning-panel
- m7-extensions-assembly: settle + fakeFiles
- m8-integration: settle + makeVehicle
- paramfile: fakeKv
- recents-store: fakeKv + fakeBlobs (recents never calls blobs.list; no error-message asserts)
- scripting-console / scripting-editor / scripting-store: fakeKv (+settle in editor)
- shell-component: settle + makeVehicle
- store: settle + `fakeKv as makeFakeKv` (peek-compatible); local makeFlakySettingsKv kept (materially different)
- plan-screen: settle + fakeFiles + fakeKv + makeVehicle (local stub fakeBlobs kept — see below)
- tracker-service: makeVehicle via 3 call-site override edits (EAST_ATTITUDE const preserves yawRad=π/2; positional `position` arg → override)

## Intentionally left (materially different fakes)

- plan-screen fakeBlobs: pure no-op stub (put discards, getRange returns empty instead of throwing) — not equivalent to in-memory helper
- plan-screen inMemoryBlobs: list always [] (helper lists entries) and used alongside the stub; left as-is
- settings-storage fakeBlobs(data): parametrized per-namespace BlobMeta map
- transport-connection-manager makeVehicle(sysid, overrides): positional required sysid, 6 call sites (>3 override edits)
- m7 memKv: out of grep scope (not a listed name)
- settings-screen.test.ts: deleted by a parallel src refactor (SettingsScreen removed); dropped from scope after my settle edit was clobbered.

## Validation

- `npx vitest run <26 files>` → Test Files 26 passed, Tests 203 passed
- `npx eslint <26 files>` → clean

---

# CONSISTENCY batch refactor (worker, 2026-06-10)

Status: COMPLETE. Behavior-neutral. Full gate green (typecheck, 175 files / 1849 tests, lint, format, build 2.53 MB).

## Tasks

- [x] T1 shared errorMessage: NEW src/core/errors.ts (`errorMessage(err)`); local duplicates swapped in setup/{modes,frame,failsafe}-step, transport/{bluetooth,serial}-transport. ext/permissions/errors.ts toErrorMessage now delegates (its string branch ≡ String(err) — identical semantics). ext/host/errors.ts LEFT AS-IS: its toErrorMessage has a JSON.stringify fallback for non-Error objects (different semantics).
- [x] T2 i18n-only renames (git mv): flight/actions/register.ts→messages.ts, widgets/gauges/register.ts→messages.ts, widgets/messages/register.ts→i18n.ts. Importers updated: the 3 barrels + test/unit/i18n-completeness.test.ts (actions/gauges now picked up by its messages.ts glob; explicit import kept only for widgets/messages/i18n.ts). README mentions updated.
- [x] T3 duration: NEW formatDurationSeconds() in core/units/format.ts (+barrel). rows.ts formatDurationS = wrapper keeping Math.round; timeline.ts formatTimecode = wrapper keeping µs→s floor. Exports preserved; gauges/hud untouched.
- [x] T4 inspector i18n: 28 inspector.\* keys moved from core/i18n/catalog.ts to NEW src/ui/widgets/inspector/messages.ts (registerMessages at import); imported from inspector/register.ts AND inspector/index.ts; INSPECTOR_MESSAGES barrel-exported (matches map/plotter/quickwatch pattern). App.tsx deep-imports inspector/register → keys still register (App.tsx not touched).
- [x] T5 dead code: deleted src/ui/widgets/map/aspect.ts + barrel line + test/unit/map-widget-aspect.test.ts (grep verified: only barrel + own test referenced it; `Box` type had zero consumers).
- [x] T6 logs path style: '../../../ui/widgets/…' → '../../widgets/…' in logs-screen.tsx (8 imports) + logs/register.tsx (2 type imports).
- [x] T7 dead alias: removed '@/\*' paths from tsconfig.json + resolve.alias from vite.config.ts ('@/' appears only in README prose, no code imports).

## Validation

- typecheck clean; vitest 175 files / 1849 tests all pass; eslint 0 errors (1 pre-existing warning in test/unit/appsettings-general.test.ts — sibling-owned, present at HEAD); prettier no changes; build OK (2.53 MB single-file).
