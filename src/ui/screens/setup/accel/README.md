# Accelerometer setup step

Task T5.4 implements `createAccelStep(deps) -> SetupStep` for the Initial Setup wizard.

## API

```ts
createAccelStep({
  calibration: Pick<CalibrationClient, 'accel6Point' | 'level'>,
});
```

## Flow states

- `idle` — nothing has started; wizard status is `todo`.
- `running` — `calibration.accel6Point(step, signal)` is active. Each `step(face)` call displays the requested pose and waits for the user to click **Vehicle is positioned** before resolving. Wizard status remains `todo`, which the wizard shell displays as `active` for the selected step.
- `done` — the full six-point accel calibration resolved; wizard status is `done`.
- `warning` — accel or level calibration rejected; wizard status is `warning`.

The six required accel faces are shown in ArduPilot order: level, LEFT side, RIGHT side, nose DOWN, nose UP, BACK. The current pose is announced in a polite live region as `face N of 6`.

The separate **Calibrate Level** button calls `calibration.level(signal)` and reports its own live state without replacing the full six-point flow.

## Tests

Pure sequence/status helpers are covered by `test/unit/setup-accel-derivation.test.ts`. The Solid component is covered by `test/unit/setup-accel-widget.test.ts` with a mock `CalibrationClient`.
