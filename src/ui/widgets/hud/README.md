# `ui/widgets/hud` — HUD / artificial horizon (T2.1)

Spec: `plan/04` §4.2 (HUD), `plan/05` §5.4/§5.5/§5.8. A canvas-rendered head-up
display for the Flight screen.

## What it draws

From a `VehicleState` (contract `src/contracts/vehicle.ts`): attitude (pitch
ladder + roll), heading tape (yaw), airspeed + groundspeed, altitude (relative +
AMSL), climb rate, throttle %, battery V/%, GPS fix + sats, EKF/vibe indicator,
flight mode, a prominent **ARMED** state, the time, and a STATUSTEXT ticker line.
An empty state is shown when no vehicle is bound.

## Prop API

```ts
interface HudProps {
  vehicle: () => VehicleState | undefined; // REACTIVE accessor (required)
  statusText?: () => string | undefined; // STATUSTEXT ticker (optional)
  colors?: () => HudColors; // palette override; else --mvp-* tokens
  now?: () => number; // clock for the time readout (default Date.now)
  t?: TFn; // i18n translate (default app `t`)
}
```

The widget is **store-agnostic**: it binds only to the `vehicle`/`statusText`
accessors. The Flight screen (T2.11) wires the store selector and passes it in —
this widget never imports the store or a context. Mounting needs the stylesheet:
`import './hud.css'` (integration step, like the inspector's CSS).

## Rendering & performance

- A `requestAnimationFrame` loop capped at the display refresh, but it rebuilds
  - repaints **only when inputs change**: `hudSignature()` produces a cheap,
    quantised change key (telemetry + a 1 Hz time tick); the frame is skipped when
    the key and canvas size are unchanged.
- HiDPI-aware and resizable: the canvas is fitted to its container via
  `ResizeObserver` and sized by `devicePixelRatio`.
- Themeable: colours come from the app `--mvp-*` CSS custom properties (with
  `--mvp-hud-sky` / `--mvp-hud-ground` / `--mvp-hud-horizon` overrides), read on
  redraw so live theme switches are honoured. `OffscreenCanvas` is not used (not
  trivially available); a normal `<canvas>` is used.

## Accessibility (spec §5.8)

The canvas has `role="img"` with a live `aria-label`, and a visually-hidden
`aria-live="polite"` paragraph mirrors a textual summary (mode / armed /
altitude / speed / battery), updated reactively on every change.

## i18n

`hud.*` strings are contributed at import time via `registerMessages` in
`./messages` — no central catalog edit. `buildHudLabels(t)` resolves them into
the label set the renderer/a11y summary use (English fallbacks built in).

## Pure-tested vs canvas-deferred

- **Pure (unit-tested, `test/unit/hud-model.test.ts`)** — all geometry
  (`radToDeg`, `wrapDeg360/180`, `pitchPixels`, `pitchLadderRungs`,
  `headingTapeTicks`) and value formatting (`fmtMeters/Speed/Climb/Throttle/
Battery/Gps/Ekf/Vibe/Heading/Clock`), the model assembly (`buildHudModel`),
  the screen-reader summary (`hudA11ySummary`) and the change key
  (`hudSignature`).
- **Component (`test/unit/hud-widget.test.ts`)** — mounts `Hud` over a signal
  accessor and asserts the a11y summary renders and updates without throwing
  (happy-dom's 2d context is `null`, so pixel output is not asserted here).
- **Canvas-deferred** — the imperative drawing in `./render` (`drawHud`). It is
  guarded against a null context and exercised by the live e2e + perf rig at the
  M2 gate (60 fps / visual snapshot), not by happy-dom unit tests.

## Owned files

`src/ui/widgets/hud/**` (`model.ts`, `colors.ts`, `render.ts`, `messages.ts`,
`types.ts`, `hud.tsx`, `hud.css`, `index.ts`, this README) and
`test/unit/hud-model.test.ts`, `test/unit/hud-widget.test.ts`.

## Known gap

`VehicleState` (frozen contract) carries no throttle field, so the throttle
readout shows `—` until/if the contract exposes it. AoA/side-slip (spec "where
available") are likewise absent from the contract and not shown.
