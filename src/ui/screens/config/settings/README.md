# `ui/screens/config/settings` — App Settings models (T3.7)

The injectable **Storage Manager** (spec plan/07 §7.3), the live unit/coordinate
**preview model** and the **Network egress-transparency section** consumed by
the App Settings pane (`ui/shell/appsettings`). The legacy `SettingsScreen` /
`createSettingsPanel` Config tab was fully migrated into that pane and removed.
Everything is store-/dependency-injected so it unit-tests without a shell or
IndexedDB.

## Live preview

The **live preview** (`preview.ts` → `core/units` + `geo/format`) renders a
sample coordinate / altitude / distance / speed in the chosen unit + coordinate
format, so the user sees exactly how their choice renders elsewhere.

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

## Tests

- `test/unit/settings-storage.test.ts` — the pure storage model (report,
  serialize/redact, export) + `createDefaultAppState` keeps the new optional
  fields unset.
