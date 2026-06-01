# `ui/screens/config/tuning` — PID / tuning panel (T3.6)

Vehicle-aware PID/tuning tables for the Config screen. Spec: plan/04 §4.5 tuning
(PID tables = **MUST**; extended-tune sliders + autotune + setpoint-vs-actual
plot = **SHOULD**).

## What it does

- **Editable PID tables (MUST).** `groups.ts` maps each `VehicleClass` to the
  ArduPilot parameter groups it tunes (Copter `ATC_RAT_*`/`ATC_ANG_*`/`PSC_*`,
  Plane `*_RATE_*`, Rover `ATC_STR_RAT_*`/`ATC_SPEED_*`). The panel renders one
  table per group with a number editor per parameter plus **units / range /
  description** resolved from the injected `ParamMetaResolver`. Staged edits
  write through `client.set` (`Write changed`).
- **Extended-tune sliders (SHOULD).** A few key `*_P` gains rendered as range
  sliders bound to the same staged-edit state.
- **Autotune (SHOULD).** Start/stop via the injected `CommandClient`
  (`MAV_CMD_DO_AUTOTUNE_ENABLE`, param1 = 1/0). Copter also exposes an
  `AUTOTUNE` flight mode; this command path is the basic SHOULD-level control and
  is hidden when no `command` is injected.
- **Setpoint-vs-actual mini-plot (SHOULD).** A noted placeholder; the live plot
  is driven by flight/SITL telemetry and is deferred to the M3 SITL gate.

## Injection seams (testability)

`TuningPanel` takes `{ client, meta, command?, vehicle, t }`:

- `client: ParamClient` — base values come from its shared cache (`get`), stay
  live via `onChange`, and `Fetch` calls `fetchAll`; `set` performs writes.
- `meta: ParamMetaResolver` — `name -> ParamMeta` (the `ParamMetaStore` fits).
- `command?: CommandClient` — autotune; omit to hide the controls.
- `vehicle: Accessor<{ vehicleClass } | undefined>` — selects the per-class
  groups reactively (the Config assembly derives it from the store).

The base values rely on the Parameters tab's full fetch having populated the
shared client cache; the panel also has its own `Fetch` button.

## Tests

`test/unit/tuning-panel.test.ts` mounts the panel over a mock `ParamClient` +
one-method `ParamMetaResolver` and a copter `vehicle` accessor: asserts the
Copter PID rows render, an edit marks the row modified and `Write changed` calls
`set` only for the edited param, and autotune routes through the mock command.
