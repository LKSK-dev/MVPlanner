# MVPlanner UI Remake — Implementation Plan

Follows `SPEC.md`. Strategy: **evolve the existing dock into the primary,
customizable widget workspace**, reusing every widget component + the whole
backend. Sequenced so the layout engine + widget contract land first (stable
seam), then widgets are registered, then presets, then interactions, then the
Settings editor, then migration/polish/release. Conventions: strict TS (no
`any`), TSDoc, additive-only contracts, orchestrator owns the engine/contracts/
integration/gate, workers register widgets/presets in parallel. Single-file
budget ≤5 MB. Target **0.4.0**.

Guiding rule: **never lose a feature and never regress the gate.** Each phase is
shippable; monolithic screens are retired only after their widgets + presets
reproduce them.

---

## Phase 0 — Layout engine + widget contract (orchestrator, single writer)

The frozen seam everything builds on.

- **0.1 Contracts (additive, → CONTRACTS_VERSION 1.7.0):** add optional
  `WidgetMeta` to `PanelDef`/`PanelContribution` (`src/contracts/ui.ts`):
  `icon?/category?/singleton?/defaultSize?/settingsSchema?`. `PanelApi` gains an
  optional `settings`/`onSettingsChange` for per-instance config. No shape
  changes to existing required fields.
- **0.2 Dock tree v2 (`src/ui/shell/workspace.ts`):** add `TabNode`; rename
  `PanelNode.panelId → widgetId` (+ a back-compat reader) and add
  `PanelNode.settings`. Add a `schemaVersion` to the stored `ShellLayout` + a
  `migrateShellLayout(unknown) → ShellLayout` (older single-panel → preset;
  invalid → default). **Pure reducers** (all unit-tested): `insertPanel`,
  `removePanel`, `movePanel(src,dst,zone)`, `toTab`/`fromTab`, `setActiveTab`,
  `setSplitSizes` (exists), `equalizeSplit`, `replaceNode`, `findPanel`.
- **0.3 Widget registry metadata (`src/ui/shell/registry.ts`):** carry
  `WidgetMeta` alongside `PanelDef`; expose `widgets()` (catalog) + category
  grouping for the palette.
- **0.4 Built-in presets seam (`src/ui/shell/presets.ts`, new):**
  `BUILTIN_PRESETS: Record<screenId, () => ShellWorkspace>` + `defaultLayout()`.
  (Empty/stub trees first; filled in Phase 2.)

Gate locally + commit Phase 0.

## Phase 1 — Dock v2 rendering + per-panel safety (orchestrator)

- **1.1 Dock renderer (`src/ui/shell/dock.tsx`):** render `TabNode` (tab strip +
  active body), keep split rendering + the existing resize gutters (polish:
  bigger hit area, dbl-click equalize, ArrowKey resize). Panel chrome component
  (`src/ui/shell/dock/panel-chrome.tsx`): header with icon/title + a per-widget
  menu (settings ⚙ / float (stub) / maximize / close), body slot.
- **1.2 Error boundary:** wrap each mounted widget in `<ErrorBoundary>` → a
  recoverable "widget error" card; dispose on unmount (one lifecycle path).
- **1.3 Maximize/restore** (transient overlay state) + **add/remove** wired to
  the Phase-0 reducers (with last-panel guard).
- **1.4 Drag-to-move/dock/tab (`src/ui/shell/dock/drag.tsx`):** header drag →
  drop-zone overlay (l/r/t/b/center) → `movePanel`. Pure zone-hit math unit-
  tested; the overlay is browser-verified.

## Phase 2 — Widget panelization + presets (parallel workers)

Each worker registers a slice of widgets as `PanelDef` + `WidgetMeta`, reusing
the existing component, and contributes the relevant preset subtree. Disjoint by
widget area:

- **W-A Flight widgets:** map, hud, gauges, actions, status, quickwatch,
  joystick (+ the Flight preset tree).
- **W-B Plan widgets:** map (plan layers), wpTable, planTools, planEditors
  (fence/rally/survey/terrain), terrainProfile (+ Plan preset).
- **W-C Config/Setup widgets:** params, tuning, setupWizard, tracker (+ presets).
- **W-D Logs/Sim widgets:** plotter, logSource, inspector, msgSender,
  extensions, console, apiRef (+ presets).

Workers reuse `createFlightServices`/the app services already wired in `App.tsx`;
registration goes through the shell registry. Each keeps its component's existing
tests + adds a "registers + mounts + disposes" test. Orchestrator assembles
`BUILTIN_PRESETS` from the contributed subtrees.

## Phase 3 — Navigation + workspace switching (orchestrator)

- Top-bar entries switch **workspace presets** (not screens); add a workspace
  switcher (presets + custom). Update `App.tsx`/`shell.tsx` to seed the default
  layout from presets and route nav → `activeWorkspaceId`.
- Command palette: switch workspace, add widget, save/reset layout, focus widget.
- Retire the monolithic `screen.*` panels once presets reproduce them (delete the
  screen-assembly panels; keep the widget components).

## Phase 4 — Settings → Appearance: layout editor (worker)

- New **Layout** group in `appsettings/sections/appearance.tsx` (or a new
  `layout.tsx` section): workspace preset picker, manage-widgets list + add
  palette, save-as/rename/delete custom workspace, reset-to-preset, per-widget
  settings entry, import/export `.mvplayout.json` (validated). Writes the dock
  tree via the Phase-0 reducers.

## Phase 5 — Persistence, migration, hardening (orchestrator)

- Wire `schemaVersion` + `migrateShellLayout` on hydrate; corrupt → preset.
- Migration test matrix (pre-0.4 single-panel, partial, foreign, current).
- "Every preset renders; every registered widget mounts + disposes cleanly"
  smoke test; error-boundary test; resize/move/tab reducer coverage.
- a11y/i18n sweep (keyboard for resize/move/add; `dock.*`/`appsettings.layout.*`
  keys; pseudo-loc; RTL).

## Phase 6 — Docs, gate, release

- Full gate (typecheck/test/lint/format/build + SITL + perf).
- Update `docs/user-guide.md` (new workspace UI + layout editor), `CHANGELOG.md`;
  bump `0.3.x → 0.4.0`; rebuild tracked `dist/MVPlanner.html`; tag `v0.4.0`.

---

## File map (new / changed)

```
src/contracts/ui.ts                         (0.1 WidgetMeta, PanelApi settings)
src/contracts/index.ts                      (0.1 CONTRACTS_VERSION 1.7.0)
src/ui/shell/workspace.ts                   (0.2 TabNode, reducers, migration)
src/ui/shell/registry.ts                    (0.3 widget metadata + catalog)
src/ui/shell/presets.ts                     (0.4 built-in presets)            NEW
src/ui/shell/dock.tsx                        (1.1 tabs/chrome render)
src/ui/shell/dock/{panel-chrome,drag}.tsx    (1.1/1.4)                         NEW
src/ui/shell/dock/error-card.tsx             (1.2)                             NEW
src/ui/shell/{shell,topbar}.tsx, src/App.tsx (3 nav → workspaces; seed presets)
src/ui/widgets/**/register*.ts               (2 widget PanelDef + WidgetMeta)
src/ui/screens/**                            (2 reuse components; retire screen
                                              assemblies in Phase 3)
src/ui/shell/appsettings/sections/layout.tsx (4 layout editor)                NEW
docs/user-guide.md, CHANGELOG.md, version.ts (6)
test/unit/** (reducers, migration, dock, presets, widgets, layout editor)
```

---

## Risks & mitigations

- **Scope/regression risk (biggest).** Mitigate by reusing components verbatim,
  keeping every existing test green, and retiring monolithic screens only after
  presets reproduce them. Each phase is independently shippable + gate-green.
- **Drag-and-drop is browser-heavy.** Keep all layout math in pure reducers +
  drop-zone hit functions (unit-tested); the DOM overlay is the only
  browser-verified piece. Ship resize + add/remove/tab first; drag-move can land
  slightly later without blocking the rest.
- **Persisted-layout corruption / version skew.** Schema version + migrator with
  a hard fallback to the preset; never white-screen.
- **Per-widget service wiring.** Reuse the already-wired app services; widgets
  receive them at registration exactly as the screens do today — no service
  refactor.
- **Size budget.** Reuse (not rewrite) keeps growth small; the dock + chrome are
  lightweight; monitor `check:size`.

## Sequencing summary

P0 engine+contract → P1 dock v2 render+safety → P2 widgets+presets (parallel) →
P3 nav/switch + retire screens → P4 Settings layout editor → P5 migration/
hardening → P6 docs/release. Estimated 6 orchestrated waves; P2 is the
parallelizable bulk.
