# `ui/screens/setup/compass` — Compass calibration step (T5.5)

Spec: `plan/04` §4.4 (Initial Setup → **Compass**: onboard `MAG_CAL` with live
progress and fitness/offsets display, plus declination/orientation). Plugs into
the Setup wizard framework (`../framework`, T5.2) as a single `SetupStep`.

The step holds **no** MAVLink/param logic. It drives the frozen, injected
`CalibrationClient.compass(onProgress, signal) -> { offsets }` seam (T5.1) and
optionally **reads** declination/orientation params from a `ParamClient` (T3.2);
it never writes params or touches other setup steps.

## API

```ts
import { createCompassStep } from '../compass';

const step = createCompassStep({
  calibration, // CalibrationClient — only compass(...) is used
  params,      // optional ParamClient — read-only declination/orientation hints
  poorFitnessThresholdMgauss, // optional, default 16
});

<WizardShell steps={[/* … */, step]} t={t} />;
```

### `createCompassStep(deps) -> SetupStep`

- `deps.calibration: Pick<CalibrationClient, 'compass'>` — **required**.
- `deps.params?: Pick<ParamClient, 'get' | 'onChange'>` — optional; when present,
  the pane shows read-only **declination** (`COMPASS_AUTODEC` auto vs manual
  `COMPASS_DEC`, in degrees) and **orientation** (`COMPASS_ORIENT`) hints and
  refreshes them on `onChange`.
- `deps.poorFitnessThresholdMgauss?` — fitness (mGauss) above which a completed
  calibration is flagged a poor fit (default `16`, mirroring `COMPASS_CAL_FITNESS`).

The returned `SetupStep` has `id: 'compass'`, `allowManualComplete: false` (its
status is fully derived), a "rotate the vehicle through all orientations" safety
callout, and a `status` accessor derived from the live flow state.

## Calibration-flow states

`CompassFlowState` (pure, in `derivation.ts`, mapped to the wizard's
`SettledStatus`):

| flow      | when                                                    | `status` (settled) | shell badge |
| --------- | ------------------------------------------------------- | ------------------ | ----------- |
| `idle`    | before Start / after Cancel                             | `todo`             | `active`\*  |
| `running` | `compass(...)` in progress; progress + fitness          | `todo`             | `active`\*  |
| `done`    | resolved with offsets + acceptable fitness              | `done`             | `done`      |
| `warning` | resolved with **poor** fitness, or failed/aborted-error | `warning`          | `warning`   |

\* The framework renders the transient `active` badge for the **selected**
`todo` step (`toDisplayStatus`), so a running compass step shows as `active`
while it is the active pane — satisfying "status=`active` while running".

Flow:

1. **Start** → `compass(onProgress, signal)`. `onProgress(pct, fitness?)` feeds
   the `role="progressbar"` (completion %) and the per-compass fitness readout.
2. **Cancel** → aborts the `AbortSignal` the seam owns (which sends
   `MAV_CMD_DO_CANCEL_MAG_CAL`); the step returns to `idle`.
3. **Success** → resolved offsets `[x, y, z]` are shown; `deriveResultState`
   settles `done`, or `warning` if the final fitness is poor.
4. **Failure** → rejection settles `warning` with an error message.

## Accessibility

- Progress meter: `role="progressbar"` with `aria-valuemin/max/now` and a
  localized `aria-valuetext`.
- Flow state announced via a polite `role="status"` live region; failures use
  `role="alert"`.

## Files

- `derivation.ts` — pure `clampPct` · `isPoorFitness` · `deriveResultState` ·
  `flowToSettledStatus` · `flowStatusKey` (no Solid/DOM).
- `compass-setup.tsx` — `createCompassStep` + the guided pane component.
- `compass-setup.css` — token-driven styles (no hard-coded colors).
- `messages.ts` — registers the `setup.compass.*` English catalog.
- `index.ts` — public barrel.

## Tests

- `test/unit/setup-compass-derivation.test.ts` — the pure progress/fitness/
  result-state derivation.
- `test/unit/setup-compass-widget.test.ts` — the pane over a **mock**
  `compass()`: Start streams progress, success shows offsets (`done`), poor
  fitness → `warning`, Cancel aborts the injected signal (→ idle), optional
  param hints render.

## Boundaries

Owns `src/ui/screens/setup/compass/**` + its two tests only. Imports the
calibration/param microservices and the wizard framework; does **not** edit
them, other setup steps, the screen assembly, or i18n internals (uses
`registerMessages` only).

> **Per-compass fitness note.** The frozen `compass()` seam streams a single
> `(pct, fitness?)` channel, so the pane shows the latest reported fitness rather
> than one row per magnetometer; richer per-instance fitness would require a
> seam change (out of scope for T5.5).
