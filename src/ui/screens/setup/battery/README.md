# `ui/screens/setup/battery` — Battery monitor setup (T5.9)

Exports `createBatteryStep({ params })`, a Setup wizard `SetupStep` for ArduPilot
battery monitor parameters.

## Param mapping

- `BATT_MONITOR` — monitor type dropdown (`0`, `3`, `4`, `5`, `6`, `7`, `8`).
- `BATT_VOLT_PIN` — analog voltage pin.
- `BATT_CURR_PIN` — analog current pin.
- `BATT_VOLT_MULT` — voltage divider / multiplier.
- `BATT_AMP_PERVLT` — current scaling in amps per volt.
- `BATT_AMP_OFFSET` — current offset.
- `BATT_CAPACITY` — battery capacity in mAh.

The form reads current values from `ParamClient.get`, writes edits through
`ParamClient.set`, and subscribes to `ParamClient.onChange` while mounted. The
step status is `done` when `BATT_MONITOR !== 0`.

## Presets

`BATTERY_POWER_MODULE_PRESETS` is a pure table for common power modules including
`Pixhawk standard` and `Power Module 90A`. Applying a preset writes the analog
pin and scaling parameters (`BATT_VOLT_PIN`, `BATT_CURR_PIN`, `BATT_VOLT_MULT`,
`BATT_AMP_PERVLT`, `BATT_AMP_OFFSET`) without changing `BATT_MONITOR`.

## Test seams

- `visibleFieldsForBatteryMonitor(value)` derives which fields are shown for a
  monitor type.
- `BATTERY_POWER_MODULE_PRESETS` / `batteryPresetById(id)` expose preset data for
  pure tests.
- Component tests mount `createBatteryStep` with a mock `ParamClient`.
