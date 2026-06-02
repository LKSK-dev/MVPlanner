# Application Settings — Implementation Plan

Follows `SPEC.md`. Sequenced so a single frozen seam lands first, then sections
build in parallel against it, then integration + gate. Conventions: strict TS
(no `any`), TSDoc, i18n via `t()`, scoped worker validation, orchestrator runs
the full gate + commits. Single‑file size budget ≤5 MB.

## Phase 0 — Contracts & core seams (orchestrator, single writer)

Land the shared types/state so every later piece compiles against a fixed seam.

- **C0.1 Contracts**: extend `src/contracts/store.ts` `AppSettings` with optional
  `appearance?: AppearanceSettings` and `keybinds?: Record<string,string>`; add
  the `AppearanceSettings` interface. Bump `CONTRACTS_VERSION` → `1.5.0`. Update
  `src/contracts/README.md` changelog. Keep all new fields optional.
- **C0.2 Defaults**: extend `DEFAULT_APP_SETTINGS` (in `core/store/app-state.ts`)
  only if needed (leave new fields unset → resolved by code defaults).
- **C0.3 Theme custom layer**: `src/core/theme/custom.ts` — pure
  `isValidCssColor`, `buildColorOverrides(colors) → Record<varName,value>`,
  `applyAppearance({themeMode,colors,density})` (DOM wrapper: data-theme/
  data-density + inline vars or `clearTheme()`+system), `clearColorOverrides()`,
  `serializeTheme`/`parseTheme`. Add `[data-density="compact"]` spacing overrides
  to `tokens.css`. Unit‑test the pure parts.
- **C0.4 Keybind core**: `src/core/keybinds/` — `chord.ts` (`parseChord`,
  `formatChord`, `normalizeChord`, `chordFromEvent`), `registry.ts`
  (`createKeybindRegistry({commands, overrides})` → `resolve`, `list`,
  `conflicts`, `serialize`). Pure + unit‑tested.
- **C0.5 RecentsStore**: `src/core/recents/` — `createRecentsStore({kv,blobs,now,
maxEntries,maxCacheBytes})` with `record/list/open/remove/clear` + pure
  eviction. Unit‑tested with in‑memory fakes.
- **C0.6 Map source resolver**: `src/geo/tiles` (or `src/ui/widgets/map`) gains
  `BASEMAP_PRESETS` + `basemapFromSettings(settings) → BasemapSource`. Pure +
  tested. (Does not yet wire engines — that’s Phase 2 integration.)

Gate locally (typecheck + the new unit tests). Commit C0 as one foundation
commit.

## Phase 1 — Pane shell + section framework (orchestrator)

- **P1.1 AppSettings pane**: `src/ui/shell/appsettings/` —
  - `context.ts`: `AppSettingsProvider` + `useAppSettings()` exposing
    `open()/close()/toggle()/isOpen()` and `section()/setSection()`.
  - `pane.tsx`: the left overlay drawer (mirror `connection/drawer.tsx`):
    dialog semantics, focus trap/restore, Escape/backdrop/× close, reduced
    motion, the section rail (ARIA tablist) + body slot.
  - `appsettings.css`.
  - `messages.ts` (`appsettings.*` i18n).
  - `index.ts` barrel.
- **P1.2 Brand trigger**: make `topbar.tsx` brand a button wired to
  `useAppSettings().toggle()` with the documented ARIA + `aria-keyshortcuts`.
- **P1.3 Command + keybind**: register `app.settings.open` command; default
  chord `mod+,`.
- **P1.4 Global key dispatcher**: in `shell.tsx`, install one `keydown` listener
  using the keybind registry; ignore typing targets; dispatch to commands. Wire
  the registry from the registered commands + `settings.keybinds` overrides.
- **P1.5 Mount**: `App.tsx` wraps the shell subtree with `AppSettingsProvider`
  and renders `<AppSettingsPane>`; pass `store`, registry, services, storage,
  confirm, network deps, recents store.

Sections render as children of the pane body keyed by `section()`.

## Phase 2 — Sections (parallel workers against the Phase‑0/1 seam)

Each section is a self‑contained component under
`src/ui/shell/appsettings/sections/` consuming injected deps; disjoint files.

- **W‑A Appearance** (`sections/appearance.tsx`): theme/System select, custom
  color pickers (+ hex inputs) over `core/theme/custom`, density toggle, theme
  import/export (FileIo), reset; workspace save/restore/reset buttons. Writes
  `settings.appearance`; applies live via the appearance effect.
- **W‑B Units & Language** (`sections/units.tsx`, `sections/language.tsx`):
  migrate the existing unit/coord/preview + language controls.
- **W‑C Maps** (`sections/maps.tsx`): preset picker + custom URL/key (migrated)
  - tile‑cache size/clear. Writes `settings.mapSource`.
- **W‑D Recents** (`sections/recents.tsx`): list/open/remove/clear over
  `RecentsStore`; relative time + size formatting.
- **W‑E Keybinds** (`sections/keybinds.tsx`): command list, chord capture +
  conflict UI, per‑row/all reset; writes `settings.keybinds`.
- **W‑F General/Advanced** (`sections/general.tsx`): audio/confirm/telemetry +
  Storage Manager (reuse `storage-manager.ts`) + Network section (reuse) +
  settings‑bundle export/import (`core/settings-bundle.ts` helper, new, pure
  serialize/redact + parse/validate; unit‑tested).
- **W‑G About** (`sections/about.tsx`): embed or link the existing About content.

Workers add component tests (render section with a fresh store + fakes; assert
controls read/write the store/seams). Scoped validation only.

## Phase 3 — Integration & migration (orchestrator)

- **I3.1** Wire all sections into the pane body; persist `lastSettingsSection`.
- **I3.2 Migrate Config → Settings**: remove the `settings` tab from
  `config-screen.tsx` (and its deps wiring), moving the storage/network/confirm
  deps to the pane mount in `App.tsx`. Keep `SettingsScreen`’s sub‑pieces reused
  by sections (or retire it once fully migrated). Ensure no dead imports.
- **I3.3 Appearance effect**: extend `ui/shell/settings-effects.ts` to apply
  `appearance` (themeMode incl. System, colors, density) reactively, alongside
  the existing theme/language effects.
- **I3.4 Map source → engine**: wire `basemapFromSettings` reactively in the
  Flight/Plan/Logs engine setup so preset/custom changes repaint live.
- **I3.5 Recents recording**: call `recents.record(...)` where plans/logs/tlogs/
  params are opened/saved (Plan screen, Logs screen; param file load/save), via
  injected hooks — no new contract surface.
- **I3.6 Keybinds live**: confirm the dispatcher runs rebound commands and
  ignores typing; palette/settings chords work.

## Phase 4 — Gate, docs, release (orchestrator)

- Full gate: `typecheck`, `test` (all unit, 0 skipped), `lint`, `format`,
  `build` (+ size), SITL regression unaffected.
- Update `docs/user-guide.md` (new App Settings pane; Config → Settings moved),
  `CHANGELOG.md`, bump app version (0.1.0 → 0.2.0) + rebuild the tracked
  `dist/MVPlanner.html`.
- a11y/i18n sweep: pane in the a11y checklist; keys complete; pseudo‑loc clean.

## File map (new/changed)

```
src/contracts/store.ts                         (C0.1 +AppearanceSettings, +fields)
src/contracts/index.ts                         (C0.1 CONTRACTS_VERSION 1.5.0)
src/core/theme/custom.ts                       (C0.3 new) + tokens.css (density)
src/core/keybinds/{chord,registry,index}.ts    (C0.4 new)
src/core/recents/{store,index}.ts              (C0.5 new)
src/core/settings-bundle.ts                    (W‑F new)
src/ui/widgets/map/basemaps.ts                 (C0.6 presets + resolver) [or geo/tiles]
src/ui/shell/appsettings/**                    (P1 + sections)
src/ui/shell/topbar.tsx                         (P1.2 brand button)
src/ui/shell/shell.tsx                          (P1.4 dispatcher, mount)
src/ui/shell/settings-effects.ts               (I3.3 appearance effect)
src/App.tsx                                     (P1.5 provider+mount, I3.2 deps move)
src/ui/screens/config/config-screen.tsx         (I3.2 remove Settings tab)
src/ui/screens/{plan,logs}/*                    (I3.5 recents hooks)
docs/user-guide.md, CHANGELOG.md, version.ts    (Phase 4)
test/unit/*                                      (every phase)
```

## Risks & mitigations

- **Frozen contracts**: only additive optional fields + a version bump (matches
  prior 1.x bumps). No shape changes to `Store`/`AppState` top level.
- **Scope creep (layout editor / keybinds)**: hard‑scope per §10; v1 keybinds are
  single chords; layout is density + workspace reuse only.
- **`file://` storage fragility**: mitigated by the settings‑bundle export/import
  and documented clearly.
- **Regressions migrating Config→Settings**: keep the existing tested
  sub‑components (preview, storage‑manager, network) and re‑mount them in the
  pane; update their tests’ harness, not their logic.
- **Parallel worker conflicts**: sections are disjoint files under
  `appsettings/sections/`; the pane shell + contracts land first.
