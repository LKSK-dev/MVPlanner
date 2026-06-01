# Manual control microservice (T8.6)

`ManualControlService` maps a **gamepad** onto MAVLink manual-control frames —
either `RC_CHANNELS_OVERRIDE` (msg **70**, µs pulses) or `MANUAL_CONTROL`
(msg **69**, `x`/`y`/`z`/`r` in −1000…1000 + a 16-bit button mask). Spec:
`plan/04` §4.2 (joystick, **SHOULD**, "gated by latency/transport suitability"),
gating per `plan/08` §8.2/§8.3. **This drives the vehicle — it is safety-relevant.**

> **Not in scope here:** the control panel UI + focus-loss wiring lives in
> `src/ui/widgets/joystick` (also T8.6); SITL/e2e is the milestone gate.

## Safety model

- **Off by default.** Frames are only emitted between `start()` and `stop()`.
- **Bounded rate.** The caller pumps `tick()` once per animation frame; the
  service rate-limits sends off the injected clock (`rateHz`, clamped `1…50`),
  so a fast pump can never flood the link.
- **Armed gate (optional).** With `requireArmed: true`, sends are suppressed
  (the service stays active) unless the injected `isArmed()` returns `true`.
- **Failsafe.** `stop()` ceases sending and, when `releaseOnStop` (default
  `true`), emits **one** neutralising release frame (all override channels
  ignored = `0`, or a neutral `MANUAL_CONTROL` stick). If the gamepad vanishes
  while active, `tick()` triggers the same failsafe and reports a
  `'gamepad-disconnect'` stop. The widget additionally wires `window` blur →
  `stop()` for focus-loss safety.

## Contract

```ts
createManualControlService({ send, getGamepad?, now?, getTarget?, isArmed?, config? })

start()                 // enable; next tick() sends immediately
stop(reason?)           // disable + optional release frame
tick()                  // pump one frame (rate-limited send)
isActive()  -> boolean
getConfig() -> ManualControlConfig
setConfig(patch)        // merge; rateHz re-clamped
onActiveChange(cb) -> off   // drives the "manual active" indicator
onAction(cb)       -> off   // button → named action edges
dispose()
```

- `send(name, fields)` is injected (bound to the host `sendMessage`), so the
  service never imports the worker and is fully unit-testable.
- `getGamepad()` returns a structural `GamepadSnapshot` (`axes`, `buttons`,
  `connected?`); the browser `Gamepad` satisfies it, tests pass a plain object.
  The default source reports no pad (the safe default).
- `now()` is the rate-limit clock (default `performance.now`/`Date.now`).
- `getTarget()` resolves the override `(sysid, compid)` (default `1/1`).
- `isArmed()` is consulted only under `requireArmed`.

## Axis → channel transform (pure, exported, tested)

`shapeAxis(raw, shape)` applies, in order: **clamp** to `[-1, 1]` → **deadzone**
(rescaled so the live band still spans full range) → **expo** (cubic blend) →
**reverse** → **trim** (re-clamped). Then:

- `axisToPulse(v, { min, center, max })` → µs pulse (piecewise so an asymmetric
  centre still hits `min`/`center`/`max`); rounded + clamped. Default
  1000/1500/2000.
- `axisToManual(v)` → `-1000…1000` (rounded + clamped).
- `isIgnoredPulse(us)` → `true` for the `0` / `65535` "release" sentinels.

`RC_CHANNELS_OVERRIDE` is built with all 18 channels defaulting to `0` (ignore);
mapped channels get their shaped pulse. `MANUAL_CONTROL` reads the `x`/`y`/`z`/`r`
axis map (unmapped → `0`) and ORs the pressed, bit-bound buttons into the mask.

## Owned files

- `transform.ts` — pure shaping + encoders (no deps).
- `constants.ts` — message names/ids (from `common`), rate bounds.
- `types.ts` — config, deps, gamepad + mapping types.
- `manual-control-service.ts` — the service + factory.
- `index.ts` — public exports.

## Testing

`test/unit/manual-transform.test.ts` (pure): deadzone/expo/reverse/trim →
expected normalised values; `axisToPulse` µs at −1/0/+1 and asymmetric ranges;
`axisToManual`; `isIgnoredPulse`. `test/unit/manual-control.test.ts` (fake
gamepad + fake clock + capturing `send`): RC override encoding (ignore = 0 for
unmapped, mapped pulses), `MANUAL_CONTROL` axis + button-mask mapping,
rate-limited sends, start/stop, focus-loss/disconnect failsafe stops sending +
emits a release, armed-gating suppression, and button→action edges.
