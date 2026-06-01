# `ui/widgets/cmd-editor` — MAV_CMD command editor (T4.2)

Spec: `plan/04` §4.3 ("full MAV_CMD command palette … with per-command parameter
editors driven by dialect metadata"), `plan/05` §5.4/§5.9.

A **metadata-driven** command palette + per-command parameter editor. Both
components are **controlled** (`value` + `onChange`) over the `geo/mission`
`MissionItemModel`, so the waypoint table (T4.3) and map editing (T4.4) drive
them from the same editing model.

## Components

### `CmdPicker`

A grouped `<select>` of `MAV_CMD`s. Props:

- `value: number` — selected command id.
- `onChange: (command: number) => void`.
- `t: TFn` — i18n.
- `commands?: MavCmdMeta[]` — override the offered set (default: the curated
  mission command set from `curatedCommandMetas()`).

Commands are grouped by category — **Navigation** (`NAV_*`), **Actions (DO)**
(`DO_*`), **Conditions** (`CONDITION_*`), **Other** — in `<optgroup>`s.

### `CmdEditor`

The per-command parameter editor. Props:

- `value: MissionItemModel` — the edited item (controlled).
- `onChange: (next: MissionItemModel) => void` — fired on any field change.
- `t: TFn`.
- `commands?: MavCmdMeta[]` — passed through to the picker.

It renders:

1. the command `CmdPicker`,
2. an altitude-**frame** select (`relative` / `amsl` / `terrain`, mapped to/from
   `MAV_FRAME` by `geo/mission`),
3. the seven command slots — `param1..param4` under **Parameters**, then `x`/`y`/
   `z` under **Position** — each labelled from the dialect `MAV_CMD` metadata.

Slots the command does not use (no dialect label) fall back to a generic label
(`Param N` / `Latitude` / `Longitude` / `Altitude`) and render muted, but stay
editable. E.g. for `NAV_WAYPOINT` (16) the slots read _Hold / Accept Radius /
Pass Radius / Yaw / Latitude / Longitude / Altitude_; for `DO_CHANGE_SPEED`
(178) they read _Speed Type / Speed / Throttle / Relative_ with the position
slots muted.

## Metadata source

Slot labels, grouping and the curated list resolve against the bundled
`MAV_CMD` dialect metadata via `geo/mission`'s `defaultCommandCatalog()` /
`MavCmdMeta` (`{ value, name, shortName, description?, category, params (7
labels), hasPosition }`). The dialects are **import-only**.

## i18n

Importing the module registers the widget's `cmd.*` and `mission.*` English
strings through `core/i18n` `registerMessages` (idempotent; never edits the
central catalog). The `mission.frame.*` and `mission.estimate.*` keys are shared
with the waypoint table (T4.3).

## How to test

`test/unit/cmd-editor.test.ts` — renders `CmdEditor` over a mock `onChange`:
asserts the metadata-driven labels for `NAV_WAYPOINT` + `DO_CHANGE_SPEED`, that
editing a slot fires `onChange` with the right field updated, that the picker
changes the command, and that the frame select maps to the right `MAV_FRAME`.

> **Integration note.** Per the task boundary this widget does NOT edit
> `src/App.tsx` or the Plan screen; wiring it into the waypoint table / map
> editing is T4.3 / T4.4. The single CSS import
> (`import './ui/widgets/cmd-editor/cmd-editor.css'`) is the integrator's step.
