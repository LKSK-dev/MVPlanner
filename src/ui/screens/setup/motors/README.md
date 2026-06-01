# `ui/screens/setup/motors` — ESC calibration + motor test (T5.10)

Exports `createMotorsStep(deps)`, an **optional** Setup wizard `SetupStep` for
ESC calibration and per-motor testing. **SAFETY-CRITICAL**: these controls spin
propellers, so gating is the whole point of this step.

```ts
const step = createMotorsStep({
  command: commandClient, // Pick<CommandClient, 'send'>
  confirm: ui.confirm, // UiRegistry['confirm']
  params: paramClient, // optional — enables ESC-cal param writes
  getVehicleClass: () => activeVehicle.vehicleClass,
  getArmed: () => activeVehicle.armed,
});
```

## Status

The step is **optional** and never forces completion: its status accessor always
returns `'na'` (an optional diagnostics step), so it counts as satisfied without
a manual "mark complete". `allowManualComplete` is `false`.

## Motor-test command mapping

Motor tests use `MAV_CMD_DO_MOTOR_TEST` (command **209**) via
`CommandClient.send(209, params)`. `motorTestCommandParams()` maps an intent to
the 7-slot vector:

| Slot     | Meaning                          | Value                            |
| -------- | -------------------------------- | -------------------------------- |
| `param1` | motor instance (1-based)         | `instance`                       |
| `param2` | throttle type                    | `0` = percent                    |
| `param3` | throttle value (%)               | clamped to `≤ 25%`               |
| `param4` | timeout (s)                      | clamped to `≤ 10s`               |
| `param5` | motor count (`0` = single motor) | `0` for per-motor sends          |
| `param6` | test order                       | `0` (`MOTOR_TEST_ORDER_DEFAULT`) |
| `param7` | unused                           | `0`                              |

Defaults are deliberately **low/short**: `5%` throttle, `2s` timeout.

- **Per-motor test** sends one `DO_MOTOR_TEST` for the chosen instance.
- **"Test all in sequence"** confirms once, then **iterates** motors `1..count`,
  sending one `DO_MOTOR_TEST` per motor instance.
- **Emergency stop** sends `motorTestStopParams(instance)` (throttle `0`, timeout
  `0`) for every motor — no confirmation, always available.

`count` is seeded from `defaultMotorCount(vehicleClass, frameClass?)`: when a
`(Q_)FRAME_CLASS` is known the count is derived from the geometry (Quad `4`,
Hexa `6`, Octa/OctaQuad `8`, Y6 `6`, Tri `3`, …); otherwise copter `4`, sub `6`,
plane `4` (a QuadPlane — a pure fixed-wing user adjusts to `1`), else `1`. It is
user-adjustable within `[1, 12]`.

## Safety gating (the point of this step)

Before **any** motor command, three independent checks apply:

1. **Persistent "props removed" acknowledgement** — a checkbox gate; motor-test
   buttons stay disabled until acknowledged.
2. **Armed/in-air guard** — `getArmed()` disables the motor-test buttons and
   shows an alert while armed.
3. **Prominent confirmation** — `confirm({ title: 'Confirm propellers are
REMOVED', body, destructive: true, armedAware: true })`. Declining sends
   **nothing**.

Destructive buttons are marked beyond colour (danger border + bold weight).

## ESC calibration

All-at-once ESC calibration is **procedural**: the step shows strongly-worded
step-by-step instructions. When a `ParamClient` is injected, "Arm ESC
calibration" writes `ESC_CALIBRATION = 3` **behind the same confirmation**, and
"Reset to normal" writes `ESC_CALIBRATION = 0`. Without a `ParamClient` the step
degrades to instructions only.

## Tests

- `test/unit/setup-motors-mapping.test.ts` covers the pure command mapping,
  clamps, default motor counts, and stop params.
- `test/unit/setup-motors-widget.test.ts` mounts the step with a **mock**
  `command.send` + **mock** `confirm` and asserts: `confirm=false` sends nothing;
  `confirm=true` sends `DO_MOTOR_TEST(209)` with the right params; "test all"
  iterates motors; emergency stop sends stop commands; `confirm` is armed-aware;
  controls gate on the ack checkbox and armed state.
