# MVPlanner UI Remake — Specification

Status: draft for review · Target: MVPlanner 0.4.0 · Author: orchestrator
Supersedes: the monolithic-screen shell. Backend (contracts, MAVLink,
microservices, geo, data, ext) is **unchanged**.

---

## 1. Vision & principles

Rebuild the **UI shell** into a customizable, dockable **widget workspace** with
three first-class goals:

- **Stability** — one well-tested layout engine; schema-versioned, migratable
  persisted layouts; every panel isolated by an error boundary so one widget
  can never blank the app; deterministic, unit-tested layout reducers.
- **Consistency** — one panel chrome, one design-token system (existing
  `core/theme`), one widget contract, one set of interactions everywhere.
- **Customizability** — drag dividers to resize; drag panels to move / tab /
  split; add/remove widgets; save/load/reset layouts; per-widget settings; all
  surfaced in **MVPlanner Settings → Appearance**.

**Key architectural decision: evolve, don't rewrite.** The current dock
(`src/ui/shell/dock.tsx` + `src/ui/shell/workspace.ts`) already implements a
split/panel tree with **draggable, persisted resize gutters** and registry-driven
panel mounting. Today it hosts a single "active-screen" panel. The remake
**decomposes the six monolithic screens into individual dockable widget panels**
over that same engine and makes the engine the primary surface. Every existing
widget component (HUD, gauges, map, plotter, inspector, paramgrid, etc.) and the
entire non-UI backend are **reused**. This is the lowest-risk path to a stable,
customizable UI.

---

## 2. Core concepts

- **Widget** — the unit of UI: a registered, self-contained, movable, resizable
  panel (HUD, Map, Gauges, Waypoint Table, Plotter, Inspector, Parameters, …).
  Backed by a `PanelDef` (`src/contracts/ui.ts`) + new metadata (§6).
- **Dock tree** — a layout is a tree of **split** nodes (tile children along an
  axis, fractional sizes, resize gutters) and **tab** nodes (stack widgets,
  selectable tabs) and **panel** leaves (one widget instance). Extends the
  current `DockNode` (`PanelNode | SplitNode`) with a new `TabNode` (§4).
- **Workspace** — a named, savable dock tree (`ShellWorkspace`). The six
  "screens" become **built-in workspace presets** (Flight, Plan, Setup, Config,
  Logs, Sim). Users can edit them and save **custom workspaces**.
- **Panel chrome** — every widget renders inside identical chrome: a header
  (icon, title, per-widget menu: settings / float / close / maximize) + a body.
- **Layout editor** — drag interactions + a Settings → Appearance surface to
  add/remove/arrange widgets and manage workspaces.

---

## 3. Widget catalog (screen decomposition)

Each current screen is decomposed into reusable widgets (component already
exists in `src/ui/widgets/**` / `src/ui/screens/**`; the remake registers it as a
`PanelDef`). Category drives the "Add widget" palette grouping.

| Widget id                          | Source component                                       | Category      |
| ---------------------------------- | ------------------------------------------------------ | ------------- |
| `widget.map`                       | `ui/widgets/map` `MapWidget` (+ layer set per context) | Flight / Plan |
| `widget.hud`                       | `ui/widgets/hud`                                       | Flight        |
| `widget.gauges`                    | `ui/widgets/gauges` `InstrumentPanel`                  | Flight        |
| `widget.actions`                   | `ui/screens/flight` actions/quick controls             | Flight        |
| `widget.status`                    | flight STATUSTEXT console / status                     | Flight        |
| `widget.quickwatch`                | `ui/widgets/quickwatch`                                | Flight / Logs |
| `widget.joystick`                  | `ui/widgets/joystick`                                  | Flight        |
| `widget.wpTable`                   | `ui/screens/plan/table` `WaypointTable`                | Plan          |
| `widget.planTools`                 | plan tool rail + transfer toolbar                      | Plan          |
| `widget.planEditors`               | fence / rally / survey / terrain drawer                | Plan          |
| `widget.terrainProfile`            | `ui/screens/plan/terrain`                              | Plan          |
| `widget.params`                    | `ui/screens/config/params` workbench                   | Config        |
| `widget.tuning`                    | `ui/screens/config/tuning`                             | Config        |
| `widget.setupWizard`               | `ui/screens/setup` wizard (frame/accel/…)              | Setup         |
| `widget.plotter`                   | `ui/widgets/plotter`                                   | Logs          |
| `widget.logSource`                 | logs source picker + playback                          | Logs          |
| `widget.inspector`                 | `ui/widgets/inspector`                                 | Flight / Logs |
| `widget.msgSender`                 | `ui/widgets/msg-sender`                                | Logs          |
| `widget.extensions`                | `ui/screens/sim` ExtensionsManager                     | Sim           |
| `widget.console`                   | scripting console                                      | Sim           |
| `widget.apiRef`                    | API reference                                          | Sim           |
| `widget.tracker`                   | antenna tracker                                        | Setup         |
| `widget.adsb`, `widget.forward`, … | existing dockable panels                               | Various       |

Widgets that need shared services (mission client, host, store) receive them via
the existing app-scoped services (`createFlightServices`) injected at
registration — **no change to the service layer**.

---

## 4. Layout model

```ts
type DockNode = SplitNode | TabNode | PanelNode;

interface SplitNode {
  // tiles children along one axis (resizable)
  type: 'split';
  id: string;
  direction: 'row' | 'column';
  sizes: number[]; // fractional, one per child (existing)
  children: DockNode[];
}
interface TabNode {
  // NEW: stacked widgets, one visible
  type: 'tabs';
  id: string;
  active: number; // index of the visible child
  children: PanelNode[];
}
interface PanelNode {
  // one widget instance
  type: 'panel';
  id: string; // instance id (stable)
  widgetId: string; // registered widget id (was `panelId`)
  settings?: Record<string, unknown>; // NEW: per-instance widget config
}
```

- **Persistence.** Layouts live in `LayoutState.workspaces` (frozen contract,
  `Record<string,unknown>` — no contract change needed; the shell owns the
  concrete shape under `SHELL_LAYOUT_KEY`). A **`schemaVersion`** field is added
  to the stored `ShellLayout`; a **migrator** upgrades older/foreign shapes (and
  falls back to the default preset on any parse failure). Layouts survive
  reloads (already wired through the store's KV persistence).
- **Built-in presets** ship as code (`defaultWorkspaceFor(screenId)`), always
  available and re-applied on "Reset layout". User edits are stored separately so
  a preset can always be restored.
- **Floating panels (Phase 4+, optional).** A workspace may carry a list of
  floating panels (position+size). v0.4 may ship tiling-only and add floating
  later; the model reserves room for it.

---

## 5. Interactions

- **Resize** — drag a divider (gutter) between tiles (already implemented;
  polished: wider hit area, double-click to equalize, keyboard arrows on the
  `role="separator"`). Sizes persist.
- **Move / dock / undock / tab** — drag a panel header onto another panel to
  show **drop zones** (left/right/top/bottom → split; center → add as a tab).
  Dropping rearranges the dock tree. (Pure tree reducers; the drag overlay is the
  only new DOM-heavy piece.)
- **Add widget** — a "+" in any tab strip / an "Add widget" command opens the
  **widget palette** (grouped by category); choosing one inserts a panel.
- **Remove** — panel header "×" (with a guard for the last panel).
- **Maximize / restore** — panel header toggle expands a panel to fill the
  workspace; restore returns it. (A transient overlay state, not persisted.)
- **Per-widget settings** — panel header "⚙" opens that widget's settings popover
  (driven by the widget's declared settings schema, §6), written to
  `PanelNode.settings`.

All interactions are **keyboard-accessible** (focusable headers/gutters, a
command-palette equivalent for every action) and respect `prefers-reduced-motion`.

---

## 6. Widget contract (consistency)

Extend the panel registration so every widget is self-describing. The frozen
`PanelDef`/`PanelContribution` (`src/contracts/ui.ts`) gain **optional** metadata
(additive) consumed by the dock + palette + editor:

```ts
interface WidgetMeta {
  icon?: string;
  category?: string; // palette grouping
  singleton?: boolean; // at most one instance (e.g. HUD)
  defaultSize?: { w?: number; h?: number };
  settingsSchema?: WidgetSettingField[]; // declarative per-widget settings
}
```

`mount(el, api)` is unchanged; `api` gains the panel's `settings` accessor +
`onSettingsChange`. A widget that declares a `settingsSchema` gets an
auto-generated settings popover; complex widgets may render their own.

**Consistency rules:** one chrome component, token-only styling (no hard-coded
colors — extends the 0.3 audit), one focus-ring, one density scale, identical
header affordances, identical empty/error states.

---

## 7. MVPlanner Settings → Appearance: layout & widgets

A new **Layout** group in the Appearance section:

- **Workspace preset** picker (Flight/Plan/Setup/Config/Logs/Sim + custom).
- **Manage widgets** — list the widgets in the active workspace with toggle
  add/remove; an "Add widget" palette.
- **Save as workspace…** (name) / **Rename** / **Delete** custom workspaces /
  **Reset to preset**.
- **Per-widget settings** entry points (mirror the in-panel ⚙).
- **Import/Export layout** (`.mvplayout.json`, validated like themes).
- Existing Appearance controls (theme/colors/density/theme manager) stay; this
  extends them so "windows, widgets and layout" are all configured here, as
  requested.

---

## 8. Stability engineering

- **One layout engine.** All layout mutations go through pure, unit-tested
  reducers in `workspace.ts` (split/insert/remove/move/tab/resize/migrate). No
  ad-hoc DOM layout in screens.
- **Per-panel error boundary.** Each `DockPanelView` wraps its mounted widget in
  a Solid `<ErrorBoundary>` that shows a recoverable "widget crashed — reload"
  card; a faulty widget never blanks the app.
- **Schema-versioned persistence + migration** with a safe fallback to the
  preset (no white-screen on a bad stored layout).
- **Single mount lifecycle.** Panels mount/unmount through one code path with
  guaranteed dispose (already the pattern in `dock.tsx`); no leaks on
  rearrange/close.
- **Test strategy:** reducers (pure) → near-100%; dock interactions via
  component tests (drop-zone math, tab switching, resize math already pure in
  `split/resize.ts`); each widget keeps its existing tests; a migration test
  matrix; a "every built-in preset renders + every widget mounts/disposes" smoke
  test.

---

## 9. Navigation model

The top bar keeps the six entries, but they now **switch workspace presets**
(not monolithic screens): clicking "Flight" activates the Flight workspace.
Users may also create/select custom workspaces from a workspace switcher. The
brand still opens **MVPlanner Settings**; `Shift+S` unchanged. The command
palette gains: switch workspace, add widget, save/reset layout, focus widget.

---

## 10. Accessibility, i18n, theming

- Panels are labelled regions; headers/gutters/tabs are keyboard operable; drag
  has a keyboard equivalent (move/split via the panel menu + palette).
- All copy via `t()` under `dock.*` / `appsettings.layout.*`; pseudo-loc clean;
  RTL-safe (logical properties; the tree mirrors).
- Theme tokens (incl. the 0.3 outline color + custom themes) drive all chrome;
  density applies to panel padding/headers.

---

## 11. Backward compatibility & migration

- Backend, microservices, contracts: **unchanged** (additive `WidgetMeta` only).
- Existing widget components reused as-is (wrapped as `PanelDef`s).
- A persisted pre-0.4 `ShellLayout` (single active-screen panel) migrates to the
  matching preset; unknown/foreign data → default preset (never a crash).
- The monolithic screen panels are retired once their widgets are registered and
  the presets reproduce their layouts (so no feature is lost).

---

## 12. Non-goals (v0.4) / phased scope

- **Floating/overlapping windows** — reserved in the model; tiling+tabs ship
  first; floating can follow.
- **Multi-monitor / pop-out OS windows** — out of scope.
- **Per-widget plugin marketplace** — out of scope (extensions already exist).
- No backend/protocol changes.

---

## 13. Acceptance criteria

1. Every current feature is reachable as a widget; the six presets reproduce
   today's screens with no lost functionality.
2. Dividers between panels drag-resize (mouse + keyboard); sizes persist.
3. Users can add/remove/move/tab/maximize widgets and save/reset layouts; all of
   it is also configurable in **Settings → Appearance**.
4. A faulty widget shows a recoverable card and never blanks the app; a corrupt
   stored layout falls back to a preset.
5. Layouts persist across reloads and migrate from older versions.
6. Full gate green (typecheck/test/lint/format/build + SITL); a11y/i18n clean;
   single-file size within budget.
7. Consistent chrome/tokens across every widget; per-widget settings work.
