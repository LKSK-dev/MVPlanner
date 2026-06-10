# `ui/widgets/gauges` — Instrument gauges & cards (T2.2)

Spec: `plan/04` §4.2 ("Telemetry panels & instruments"), `plan/05` §5.5 (widget
library). A set of small, **composable, themeable, accessible** instrument
gauges + value-cards for the Flight screen's instruments rail. Each gauge is a
pure presentational Solid component taking **reactive accessor props**, so the
Flight screen (T2.11) wires the store and chooses which gauges to show.

## Gauge list

| id         | title     | kind   | source / fields                                |
| ---------- | --------- | ------ | ---------------------------------------------- |
| `attitude` | Attitude  | canvas | `vehicle().attitude` (mini artificial-horizon) |
| `compass`  | Heading   | canvas | `vehicle().attitude.yawRad` + cardinal         |
| `vsi`      | Climb     | canvas | `vehicle().velocity.climbMs`                   |
| `airspeed` | Speed     | card   | groundspeed (+ airspeed when present)          |
| `battery`  | Battery   | card   | voltage / current / remaining % (thresholded)  |
| `gps`      | GPS       | card   | fix type (decoded) / sats / HDOP               |
| `ekf`      | EKF       | card   | `vehicle().ekfOk`                              |
| `vibe`     | Vibration | card   | `vehicle().vibe` x/y/z (warn 30, error 60)     |
| `rc`       | RC in/out | card   | `rc()` channels — empty state when absent      |
| `system`   | System    | card   | armed + mode                                   |
| `link`     | Link      | card   | `LinkStats` rate / loss / RSSI / signed        |
| `nav`      | Waypoint  | card   | current WP / distance / ETA from `nav()`       |

Canvas dials (attitude/compass/vsi) split **pure geometry** (`geometry.ts`,
unit-tested) from the `ctx` 2D draw passes (`canvas-gauges.tsx`). Under
happy-dom the 2D context is a stub (`getContext('2d')` → `null`); the draw pass
is skipped and the always-present **text readout** is what tests assert on.

## Prop API

Every gauge is `Component<GaugeProps>`:

```ts
interface GaugeProps {
  vehicle: () => VehicleState | undefined; // reactive
  link?: () => LinkStats | undefined; // defaults to vehicle().link
  rc?: () => RcState | undefined; // widget-local view model
  nav?: () => NavProgress | undefined; // widget-local view model
  t: TFn;
  units: UnitHook; // default metricUnits
}
```

`RcState` (RC in/out channels) and `NavProgress` (current-WP/distance/ETA) are
**widget-local view models** — they are NOT part of the frozen `VehicleState`
contract, so T2.11 maps its sources (message registry / mission service) into
them when wiring the gauges. This avoids a contract change for T2.2.

## Selection mechanism

`registry.ts` exposes a flat ordered `GAUGES: GaugeDescriptor[]`
(`{ id, labelKey, kind, component }`), `DEFAULT_GAUGE_SELECTION`, `getGauge(id)`
and `resolveSelection(ids?)`. The `InstrumentPanel` container renders a
configurable selection (`selection?: string[]`, default = all) by fanning the
shared accessors into each gauge via `<Dynamic>`. A persisted per-vehicle
selection (settings/workspace) just drives `selection`.

## Units (thin hook — full system is T3.7/T3.8)

`units.ts` ships ONLY `metricUnits` plus the `UnitHook` seam (speed / altitude /
distance / climb). It is the default; T3.7/T3.8 inject an imperial hook via
`GaugeProps.units` with no gauge changes. Each method returns a locale number
string + an i18n unit-symbol **key**, so display stays translatable and the hook
stays free of copy.

## i18n

`messages.ts` contributes the `gauges.*` English namespace via the public
`registerMessages` seam (imported for side effect by `index.ts`). Values use
`core/i18n` `formatNumber`/`formatDecimal`/`formatInteger`. Each reading carries
a `data-status` cue **and** a leading text marker for warn/error, so status is
never color-only (spec §5.8).

## How to test

- `test/unit/gauges-format.test.ts` — pure geometry / units / readings /
  registry-selection logic.
- `test/unit/gauges-widget.test.ts` — components over reactive accessors:
  rendering, reactive updates, status attributes, link fallback, RC empty state,
  the canvas text readout (null 2D context), and panel selection.

> **Integration note.** Per the task boundary this widget does NOT edit
> `src/App.tsx` or the Flight screen. The single wiring step — mounting
> `InstrumentPanel` (or individual gauges) with store-backed accessors and
> `import './ui/widgets/gauges/gauges.css'` — belongs to T2.11 / the
> orchestrator's integration.
