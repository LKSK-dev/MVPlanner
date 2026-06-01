# `ui/screens/config/settings` — App Settings (T3.7)

The **Settings** tab of the Config screen (spec plan/04 §4.5 planner/app
settings, plan/05 §5.4 Settings) plus the **Storage Manager** (spec plan/07
§7.3). Everything is store-/dependency-injected so it unit-tests without a shell
or IndexedDB.

## What it does

Edits `store.settings` through `store.patch` (the single writer):

| Setting             | `AppSettings` field              | Control                                       |
| ------------------- | -------------------------------- | --------------------------------------------- |
| Unit system         | `units`                          | select (metric / imperial)                    |
| Coordinate format   | `coordinateFormat`               | select (DD / DMS / UTM / MGRS)                |
| Theme               | `theme`                          | select (dark / light / high-contrast / field) |
| Language            | `language`                       | select (registered locales)                   |
| Audio alerts        | `audioAlerts`                    | checkbox                                      |
| Confirm destructive | `confirmDestructive`             | checkbox                                      |
| Map source          | `mapSource` _(added T3.7)_       | URL template + optional API key               |
| Telemetry rate      | `telemetryRateHz` _(added T3.7)_ | number (Hz)                                   |

A **live preview** (`preview.ts` → `core/units` + `geo/format`) renders a sample
coordinate / altitude / distance / speed in the chosen unit + coordinate format,
so the user sees exactly how their choice renders elsewhere.

> **Theme + language are applied app-wide by the shell's settings effects**
> (`ui/shell/settings-effects.ts`), which react to the same `store.settings`
> fields. This screen only **writes** them — it never calls `applyTheme` /
> `setLocale` itself, to keep a single application point.

## Contract change (additive — contracts 1.3.0)

T3.7 extended `AppSettings` (orchestrator-approved) with two **optional** fields:

- `mapSource?: { urlTemplate: string; apiKey?: string }`
- `telemetryRateHz?: number`

Both are optional and left **unset** in `createDefaultAppState()` so persisted /
older state and the existing default-state equality stay valid. The map
`apiKey` is a local secret (spec plan/07 §7.7) and is **redacted by default**
from setting exports.

## Storage Manager (spec plan/07 §7.3)

`storage-manager.ts` is a pure, fully-injected model:

- `loadStorageReport(deps)` → origin usage via `navigator.storage.estimate`
  (when available, built by `browserStorageEstimate()`) + per-namespace blob
  sizes from the storage foundation's `BlobStore` (default namespace: `tiles`).
- Actions: **clear tile cache**, **clear all data** (factory reset, behind the
  shell `confirm`), **export settings** (`exportSettings` → redacted JSON via the
  injected `saveFile` / FileIo).

The browser wiring (real `navigator.storage`, the storage foundation, the tile
cache, FileIo) is assembled by the app shell and passed in as
`StorageManagerDeps`; tests pass fakes. When `storage` is omitted, the section
renders a disabled "unavailable" state.

## Registration

`createSettingsPanel(deps)` builds the dockable `config.settings` `PanelDef`
(mounts `SettingsScreen` via an imperative Solid `render()` root, capturing deps
by closure) for the Config screen assembly / workspaces.

## Tests

- `test/unit/settings-screen.test.ts` — each control patches `store.settings`;
  the preview reflects unit/coord choice; the Storage Manager lists usage and the
  clear/export actions call the injected handles.
- `test/unit/settings-storage.test.ts` — the pure storage model (report,
  serialize/redact, export) + `createDefaultAppState` keeps the new optional
  fields unset.
