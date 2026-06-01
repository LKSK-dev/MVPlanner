# `ui/widgets/joystick` — Joystick / gamepad control panel (T8.6)

Spec: `plan/04` §4.2 ("Gamepad API → `RC_CHANNELS_OVERRIDE` / `MANUAL_CONTROL`,
with per-axis mapping/expo/trim, button→action binding, deadzone, failsafe on
focus-loss, and a prominent 'manual control active' indicator. Gated by
latency/transport suitability."), `plan/05` §5.4/§5.5. **SAFETY-relevant — this
panel arms live manual vehicle control.**

The wire encoding + shaping pipeline + rate-limit + start/stop + failsafe + gating
all live in the **`src/mavlink/microservices/manual`** service; this widget is the
control surface for it.

## What it shows

- A prominent **"MANUAL CONTROL ACTIVE"** banner (loud, `aria-live="assertive"`)
  whenever the service is active, and a muted "off" status otherwise.
- A standing **warning** + a **failsafe note**.
- An **enable/disable** toggle (`aria-pressed`), an **output** selector
  (RC override / manual control), a **send-rate** input (Hz), and an
  **"only send when armed"** checkbox.
- A live **axis/button readout** (axis values + a bar; pressed buttons
  highlighted), refreshed every pump frame while active.
- The per-axis **mapping editors**: channel (RC mode) / axis name (manual mode),
  gamepad-axis index, **deadzone**, **expo**, **trim** and **reverse**.

## Failsafe + pump

- On mount the widget adds a `blur` listener to the failsafe target (default the
  global `window`) → `service.stop()`. Losing focus immediately ceases sending
  and emits the service's release frame.
- While active, the widget runs a pump loop (default `requestAnimationFrame`):
  each frame it samples the gamepad for the live readout and calls
  `service.tick()` (which is itself rate-limited). The loop is cancelled when the
  service goes inactive or the widget unmounts.

## Props (injected — no Worker)

```ts
interface JoystickProps {
  service: ManualControlService; // pure service (no Worker)
  gamepad: GamepadSource; // () => GamepadSnapshot | undefined
  t: TFn; // i18n
  schedule?: (cb) => () => void; // pump scheduler (default rAF loop)
  failsafeTarget?: FailsafeTarget; // blur source (default window)
}
```

Registration glue (mirrors the other widgets):

- `createJoystickPanel(service, gamepad, t, opts?): PanelDef` — dockable panel
  (id `widget.joystick`).
- `registerJoystick(registry, service, gamepad, t, opts?): () => void` —
  registers the panel; the returned disposer unregisters it.

## Accessibility / i18n

- The active banner is a `role="status"` `aria-live="assertive"` region; the
  toggle exposes `aria-pressed`; axis/button lists are labelled.
- All strings route through `t()` under the `joystick.*` namespace, registered at
  import via `registerMessages` (`./messages`) — never editing the central
  catalog.

## Integration note

Per the task boundary this widget does NOT edit the Flight screen. The wiring —
construct a `ManualControlService` over the host `sendMessage` + a Gamepad-API
source, then `registerJoystick(registry, service, gamepad, t)` plus
`import './ui/widgets/joystick/joystick.css'` — is the Flight-screen assembly's
step. **Latency note:** per spec the panel is "gated by latency/transport
suitability"; manual RC over high-latency links (WebSocket/WebRTC bridges) is
risky and the assembly should surface/limit it.

## How to test

- `test/unit/manual-transform.test.ts` + `test/unit/manual-control.test.ts` —
  the pure transform + the service (see the microservice README).
- `test/unit/joystick-widget.test.ts` — the widget over a real service + a fake
  gamepad: the active indicator toggles on enable/disable, the mapping editors
  render + edit shape (deadzone/expo/trim/reverse) through to `service`, the live
  readout reflects the gamepad, and the `window`-blur failsafe stops the service.
