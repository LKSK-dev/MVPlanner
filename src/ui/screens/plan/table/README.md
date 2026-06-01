# `ui/screens/plan/table` — waypoint table (T4.3)

Spec: `plan/04` §4.3 (waypoint table); `plan/05` §5.4 (Plan), §5.7 (undo).
Work-breakdown `plan/implementation/03` §T4.3.

An editable, spreadsheet-like **waypoint table** over the FROZEN `geo/mission`
`MissionModel`. It is presentation + wiring only: all editing math lives in
`geo/mission` (immutable `addWaypoint` / `insertItem` / `deleteItem` / `reorder`
/ `setItem` / `setDefaultAlt` / `estimateMission`) and the per-command parameter
UI is the `ui/widgets/cmd-editor` `CmdPicker` / `CmdEditor`.

## Controlled API

```tsx
<WaypointTable model={() => mission()} onChange={(next) => setMission(next)} />
```

`WaypointTableProps`:

- **`model: () => MissionModel`** — reactive accessor for the controlled model.
- **`onChange: (next: MissionModel) => void`** — receives the next model after
  every edit, undo and redo. **The parent is the single source of truth**; the
  component holds only an internal `past`/`future` undo stack of model snapshots.
- `t?`, `units?: () => UnitSystem` (totals formatting, default metric),
  `commands?: MavCmdMeta[]` (picker set), `cruiseSpeedMps?`, `undoLimit?`.

### How the Plan assembly (T4.10) wires it

The Plan screen owns the mission signal and shares it with the map editor
(T4.4); it passes the accessor as `model` and its setter as `onChange`, so
table edits and map edits both flow through the same immutable model. Use
`createWaypointTablePanel({ model, onChange, units })` to dock it as the
`plan.table` `PanelDef` (mirrors the survey panel glue).

## Behaviour

- Per row: `CmdPicker` (command), altitude-frame `<select>`, lat/lon/alt number
  cells (lat/lon disabled for non-position commands), a **current** radio, a
  parameters expander that reveals the full `CmdEditor`, and insert / delete /
  move-up / move-down buttons.
- Toolbar: **Add waypoint**, **undo** / **redo**, **default altitude**, and live
  **distance / time / waypoints** totals (distance via `core/units`, time as
  `m:ss` / `h:mm:ss`).
- **Undo/redo**: bounded snapshot stack (default 50). Buttons + Ctrl/Cmd-Z and
  Shift+Ctrl/Cmd-Z (Ctrl/Cmd-Y also redoes). Immutable models make a snapshot a
  single reference; `commit` skips no-op edits (`next === current`).

## Pure, testable cores

- **`./rows`** — `toRows(model)` → `WaypointRow[]`, `missionTotals(model, opts)`,
  `formatDurationS(seconds)`.
- **`./undo`** — generic `History<T>` with `record` / `undo` / `redo` /
  `canUndo` / `canRedo` (present is supplied by the controlled component).

## Testing

`test/unit/wp-table-logic.test.ts` covers row derivation + undo/redo; 
`test/unit/wp-table.test.ts` mounts the component (testids: `wp-add`,
`wp-undo`/`wp-redo`, `wp-default-alt`, `wp-total-distance`/`-time`/`-waypoints`,
`wp-expand-N`/`wp-up-N`/`wp-down-N`/`wp-insert-N`/`wp-delete-N`). i18n registers
through the public `registerMessages` seam (never the i18n internals).

## Owned files

`types.ts`, `rows.ts`, `undo.ts`, `wp-table.tsx`, `messages.ts`, `wp-table.css`,
`register.tsx`, `index.ts`, `README.md`.
