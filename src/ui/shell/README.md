# `ui/shell` — application shell (T0.7)

The shell wires the frozen core modules into a working, accessible application
frame (spec `plan/05` §5.2/§5.3/§5.7). It owns no domain logic — screens,
widgets and microservices land in later milestones and plug into the seams
defined here.

## What it provides

- **Top bar** (`topbar.tsx`): brand, the six primary screen nav buttons
  (drive the persisted `layout.activeScreen`), connection + placeholder status
  chips, and a command-palette button.
- **Router / screens** (`screens.ts`): the six `ScreenId` screens registered as
  empty, labelled placeholder `PanelDef`s. **No screen contents** — those are
  later milestones.
- **Command palette** (`command-palette.tsx`): ⌘/Ctrl-K, fuzzy search
  (`fuzzy.ts`) over registered commands + navigation entries, fully
  keyboard-driven (↑/↓/Enter/Escape).
- **Alert center** (`alert-center.tsx`): toast stack in an ARIA live region +
  a modal `confirm()` dialog backing `UiRegistry.confirm` (`ConfirmOptions`,
  `armedAware`).
- **Dock manager** (`dock.tsx` + `workspace.ts`): hand-rolled tiling/resizable
  panel layout with named, persistable workspaces. No heavyweight dependency —
  CSS flex + Solid signals.
- **Registry** (`registry.ts`): the shell's `UiRegistry` implementation
  (`registerPanel`/`registerCommand`/`addMenuItem`/`toast`/`confirm`), exposed
  through the shell context.
- **Boot wiring** (`settings-effects.ts`, `App.tsx`): creates the singleton
  store (IndexedDB-persisted settings/layout via `data/storage`), applies
  `settings.theme`/`settings.language` reactively, detects capabilities and
  surfaces a non-blocking notice when Web Serial is unsupported.

## Contract boundaries

- Implements `src/contracts/ui.ts` (`UiRegistry`, `PanelApi`, `CommandDef`,
  `PanelDef`, `ConfirmOptions`). Contracts are **not** modified.
- `LayoutState.workspaces` is intentionally generic (`Record<string, unknown>`).
  The shell stores its concrete dock tree under the reserved key
  `__shell__` (`SHELL_LAYOUT_KEY`) and casts only at that boundary
  (`readShellLayout`/`writeShellLayout` in `workspace.ts`).
- Capabilities are read directly from `core/capabilities` — **not** added to the
  `AppState` contract.

## Dock framework scope (M0)

The split/resize/persist/restore framework is implemented and unit-tested
(`workspace.ts`). For M0 the default workspace is a **single panel** whose
content follows `layout.activeScreen` (sentinel `@active-screen`), so the
visible docked content is just the active screen placeholder. Multi-panel
default layouts and pop-out windows are wired by the screen-assembly tasks
(T2.11/T4.10/…).

## i18n

All user-facing strings route through `t()` (`core/i18n`). The shell's catalog
keys were added **additively** to the English catalog in
`src/core/i18n/catalog.ts` (the i18n module is owned by T0.8); no existing keys
were changed.

## Testing

- `test/unit/shell-fuzzy.test.ts` — palette fuzzy scorer/filter.
- `test/unit/shell-workspace.test.ts` — dock layout helpers
  (default/read/write/resize/save/restore).
- `test/unit/shell-component.test.ts` — component tests
  (`@solidjs/testing-library`): screen navigation, palette open/filter/run,
  toast live region, theme switch → `document[data-theme]`, capabilities notice.

Run: `npm run typecheck && npm test && npm run lint && npm run build`.
