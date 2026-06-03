# UI Remake — Strict Audit (code vs SPEC) + Fixes

Date: 2026-06-02 · Audited: `v0.4.0` UI shell against `docs/ui-remake/SPEC.md`.
Method: checked each spec interaction/acceptance criterion against the
implemented code (`src/ui/shell/**`, widget registrations, the layout editor).

## A. Findings — fixed in this run (→ v0.4.1)

| #   | Spec                  | Finding (code ≠ desired)                                                                                                                   | Fix                                                                                                                                                                  |
| --- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | §5/§10, acceptance #2 | **Dividers were mouse-only** — `dock.tsx` gutter had `onPointerDown` but no keyboard handler; spec requires mouse **and** keyboard resize. | Gutter is now `tabindex=0` `role="separator"` with **Arrow-key** resize (±3%), **Home** to equalize, and a `:focus-visible` ring; **double-click** equalizes.        |
| 2   | §3, customizability   | **Only screens were addable** — no standalone widget carried `meta`, so the "Add widget" palette listed screens only.                      | Added `WidgetMeta` to **Inspector, Quick-watch, Joystick, Antenna tracker, About** (categories Telemetry/Tools/Info); they now appear in the palette + are tileable. |
| 3   | correctness           | **`canClose()` read a non-reactive snapshot** (`store.get()`), so the last-panel close-guard could go stale.                               | Reactive via `store.select(countPanels(...))`.                                                                                                                       |
| 4   | §10 a11y              | **Tab strip lacked keyboard nav + roles** — no Arrow nav, no `role="tabpanel"`, no `aria-orientation`, no roving tabindex.                 | Added Left/Right Arrow tab nav, `role="tabpanel"` bodies, `aria-orientation`, and roving `tabindex`.                                                                 |
| 5   | §5                    | **Double-click to equalize a split** not wired (reducer existed).                                                                          | Wired (gutter `dblclick` + Home key).                                                                                                                                |
| 6   | §10 i18n              | **Widget categories were hard-coded English** (`'Screens'`/`'Other'`).                                                                     | Categories are now i18n keys (`appsettings.layout.category.*`), translated in the editor.                                                                            |
| 7   | §9                    | **No layout command** in the palette.                                                                                                      | Registered `layout.reset` ("Reset workspace layout"); workspace switching is already covered by the `nav.*` commands.                                                |

Regression tests added: keyboard-resize on the divider (`test/unit/dock-v2.test.ts`).

## B. Verified correct (no change needed)

- Splits render with resizable gutters; sizes persist (store `layout`). ✓
- **Tabs** render (tab strip over stacked, all-mounted bodies → preserves widget
  state). ✓
- Consistent **panel chrome** (title + maximize/restore + close). ✓
- **Per-panel error boundary** → recoverable "widget error / reload" card. ✓
- **Maximize/restore** fills the workspace; close honours the last-panel guard
  (button hidden **and** `closeWidget` refuses). ✓
- Six **workspace presets**; nav switches `activeWorkspaceId`; App **migrates +
  ensures presets** on boot (corrupt/foreign → preset, never white-screens). ✓
- Settings → Appearance **Windows & layout** editor: workspace switcher,
  add-from-catalog, per-widget remove, reset-to-preset. ✓

## C. Remaining gaps (deferred, documented — not regressions)

- **Per-widget settings popover** (§6, acceptance #7): the contract
  (`PanelDef.meta.settingsSchema` + `PanelApi.settings`) is in place and the dock
  passes `settings` to widgets, but the in-chrome ⚙ auto-popover + the
  `onSettingsChange` persistence path are not built, and no widget declares a
  schema yet. Tracked as the next item.
- **Fine-grained screen decomposition** (§3): screens are currently _composite_
  widgets (the whole Flight screen as one widget) rather than separate
  Map/HUD/Gauges/… panels. The `WidgetMeta`/catalog/reducer machinery supports it.
- **In-canvas drag-to-move** (§5): the `movePanel` reducer + drop-zone semantics
  are implemented and unit-tested; the drag overlay UI is not yet wired.
- **Save-as custom workspace / import-export layout** (§7): i18n keys exist; the
  editor UI + a bundle (de)serializer are not built (`workspace.save` command
  saves to a fixed id).
- **`maximizedId` is a module-global signal** (minor): lingers across remounts;
  harmless (graceful fallback when the id is absent in the active workspace).

## D. Gate

typecheck ✓ · 1796 + new tests ✓ · lint clean ✓ · format ✓ · build within budget.
