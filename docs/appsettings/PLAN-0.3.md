# Implementation Plan v0.3 — bug fixes + features

Follows `SPEC-0.3.md` (settings) and covers the full 0.3 batch. Conventions:
strict TS (no `any`), TSDoc, i18n via `t()`, additive optional contracts,
orchestrator owns contracts/integration/gate, workers do scoped validation.
Single‑file budget ≤5 MB.

## Phase 0 — Contracts & core seams (orchestrator)

- **C0.1 Contracts (1.6.0, additive)** `src/contracts/store.ts`:
  - `AppearanceColorKey += 'outline'`.
  - `AppearanceSettings += themeLibrary?: InstalledTheme[]`, `activeThemeId?: string`.
  - New `InstalledTheme { id; name; bundle: ThemeBundle }` (bundle typed loosely
    as `unknown`/a local shape to avoid a contract↔theme cycle; the theme module
    owns `ThemeBundle`).
  - New `UnitPreferences` + `AppSettings.unitPreferences?`.
  - Bump `CONTRACTS_VERSION` → `1.6.0`; README changelog row.
- **C0.2 Units resolver** `src/core/units/preferences.ts`: `UNIT_PRESETS`
  (metric/imperial per quantity), `resolveUnits(settings) → ResolvedUnits`,
  `createUnitFormatter(resolved)` facade (altitude/distance/speed/climb/
  temperature/heading/coord) over `core/units` + `geo/format`. Pure + tested.
- **C0.3 Theme custom** `src/core/theme/custom.ts`: add `outline → --mvp-border`
  to `COLOR_KEY_TO_VAR` + `APPEARANCE_COLOR_KEYS`; extend `applyAppearance` to
  resolve an active **installed theme** (when `activeThemeId` set + found in
  `themeLibrary`, apply its bundle instead of inline). Add helpers
  `installTheme(library, bundle, name) → {library, id}`, `uninstallTheme`,
  `effectiveAppearance(appearance)`. Tested.
- **C0.4 Keybind default** change `app.settings.open` default chord to `shift+s`
  (App registration) + brand `aria-keyshortcuts`/tooltip. Capture‑lock signal
  plumbed in Phase 3.

Gate locally + commit Phase 0.

## Phase 1 — CRITICAL bug fixes (orchestrator + 1 worker)

- **B1.1 Window sizing / overflow** (orchestrator): audit the shell→screen
  height chain; ensure each screen root is height‑bounded with internal scroll;
  add scroll to variable lists (Plan waypoint table, fence/rally lists, setup
  steps, logs panels). Concretely: screen containers `min-height:0; overflow`
  where needed; the Plan waypoint table body gets `overflow:auto` with a bounded
  height; the pane/section already scroll. Verify no clipped controls at common
  viewport sizes. (CSS‑led; add a couple of layout unit checks where logic
  exists.)
- **B1.2 Keybinds fix + manual entry** (orchestrator, ties to C0.4): add the
  capture‑lock signal (App `keybindCapturing` → `ctx.keybindCapturing` checked by
  the shell dispatcher; `beginCapture/endCapture` on section deps); rewrite the
  Keybinds section capture to raise/lower the lock + add the manual text input
  (`normalizeChord`, conflict check). Tests: dispatcher ignores keydown while
  capturing; manual `Shift+1` binds; pressing binds; conflict blocked.

## Phase 2 — Context menu + units bug + commands (1–2 workers, disjoint)

- **B2.1 Global context‑menu suppression**: add a `contextmenu` preventDefault at
  the app root (shell) so Ctrl/right‑click never shows the browser menu — except
  inside text inputs/textarea/contenteditable (allow native menu there for
  copy/paste). One listener in `shell.tsx`.
- **B2.2 Units everywhere (bug)**: switch the Measure tool + map‑layer distance/
  area formatting and plan readouts to the unit formatter facade (C0.2), so
  imperial/per‑quantity selections apply. `geometry.ts` `formatDistanceM`/
  `formatAreaM2` gain a unit param (or the measure controller formats via the
  facade with the active resolved units from the store).
- **B2.3 Waypoint commands**: the picker shows the **full** dialect command
  catalog (all `MAV_CMD`s, grouped by category) instead of only `CURATED_COMMANDS`
  (curated still ordered first), so `VTOL_TAKEOFF`/`VTOL_LAND` etc. appear; add a
  **“Custom…”** option that reveals a numeric command input for arbitrary
  `MAV_CMD` ids. (cmd‑editor/catalog + cmd‑picker + cmd‑editor.)

## Phase 3 — Settings features (workers, against Phase‑0 seams)

- **F3.1 Units section** (worker): per‑quantity selects (preset + advanced) +
  live preview, writing `unitPreferences`/`units`. Uses C0.2.
- **F3.2 Appearance: install/manager + outline** (worker): rename Import→Install
  (adds to `themeLibrary` + selects); theme selector lists built‑ins + installed;
  Theme Manager sub‑panel (Edit/Uninstall, built‑ins protected); Outline color
  in the editor. Uses C0.3.
- **F3.3 Rename + Measure icon + default chord** (orchestrator, small): pane
  title → “MVPlanner Settings”; tool‑rail Measure glyph → ruler (📏 / a ruler
  SVG); confirm `shift+s` default + aria.

## Phase 4 — Plan persistence + Hello‑World extension (1 worker + orchestrator)

- **F4.1 Plan session persistence** (orchestrator): a `createPlanSession()`
  holding mission/fence/rally/surveyPolygon (+ profile) signals, built once in
  App and injected into the Plan panel; `PlanScreen` reads/writes the injected
  session instead of local `createSignal`, so a remount (tab switch) rehydrates.
  Tests: edit → switch away (dispose) → remount → state intact.
- **F4.2 Hello‑World extension** (worker): a new bundled example
  `extensions/hello-world.mvpext.js` that on activate adds a top‑bar box (via the
  ext UI contribution / a registered command + a small mounted control) which, on
  click, shows a “Hello World!” overlay. Registered in `extensions/index.js`;
  exercised by the ext‑examples test. Verifies the extension system end‑to‑end.
  (If the ext API cannot mount a top‑bar control directly, use the documented
  `ui` capability — a command + a toast/overlay — and note the seam used.)

## Phase 5 — Integration, gate, release

- Wire all sections/seams; full gate (typecheck/test/lint/format/build + SITL);
  update `CHANGELOG.md`, `docs/user-guide.md`; bump `0.2.0 → 0.3.0`; rebuild the
  tracked `dist/MVPlanner.html`; tag `v0.3.0`.

## File map (high‑level)

```
contracts/store.ts, contracts/index.ts                 (C0.1)
core/units/preferences.ts (+ index)                    (C0.2)
core/theme/custom.ts                                   (C0.3, outline + library)
ui/shell/shell.tsx (contextmenu, dispatcher lock), App.tsx (default chord, lock,
  plan session, hello-world wiring already via examples)
ui/shell/appsettings/{context,messages,sections/{units,appearance,keybinds}}.tsx
ui/widgets/map/tools/tools.ts, map/layers/geometry.ts  (B2.2 units)
ui/widgets/cmd-editor/{catalog,cmd-picker,cmd-editor}.tsx (B2.3 full+custom)
ui/screens/plan/{plan-screen,register}.tsx + plan-session.ts (F4.1)
ui/screens/plan/tool-rail.tsx (ruler icon), plan/table/*.css (scroll)
extensions/hello-world.mvpext.js, extensions/index.js  (F4.2)
+ tests throughout; docs/CHANGELOG/version (Phase 5)
```

## Risk notes

- Per‑quantity units: full retrofit of every formatter call site is large; this
  plan wires the **resolver/facade + the visibly‑wrong consumers** (measure, plan
  readouts, HUD/gauges that take a system) and the settings UI. Remaining
  system‑driven call sites still honor the preset; deeper per‑widget retrofit is
  incremental.
- Theme library application: `activeThemeId` vs inline editor — Edit clears
  `activeThemeId` to preview live then “Save to theme” writes back, avoiding a
  confusing dual‑source state.
- Window sizing is CSS‑led and browser‑verified; add logic tests only where pure.
