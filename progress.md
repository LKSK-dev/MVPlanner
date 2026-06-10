# Progress

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
