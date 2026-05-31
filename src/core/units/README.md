# `core/units` — metric/imperial conversions + formatters (T3.8)

Spec: `plan/05` §5.9 (i18n / units), `plan/04` §4.10 (units consistency).

Dependency-free, DOM-free conversions and locale-aware formatters for the frozen
`UnitSystem` (`'metric' | 'imperial'`). Consumed by the HUD, gauges, map and
parameter editors so every screen shows units consistently. Everything is pure
(the only side input is the active i18n locale, via `formatNumber`) and
unit-tested — see `test/unit/units.test.ts`.

## Canonical inputs

Values flow through the app in SI base units and are converted only for display:

- altitude / distance → **metres**
- speed / climb rate → **metres per second**
- temperature → **degrees Celsius**
- voltage / current / percent / angle → pass-through (no system switch)

## Modules

- **`convert.ts`** — exact conversion ratios (`M_PER_FT`, `M_PER_NM`, …) and raw
  numeric functions (`metersToFeet`, `msToKnots`, `msToMph`, `msToKmh`,
  `msToFeetPerMinute`, `celsiusToFahrenheit`, …), plus unit-token dispatch
  (`lengthFromMeters`, `speedFromMs`, `climbFromMs`, `temperatureFromCelsius`).
- **`format.ts`** — `formatAltitude` / `formatDistance` / `formatSpeed` /
  `formatClimb` / `formatTemperature(value, system, opts)` → localized string +
  unit suffix; pass-throughs `formatVoltage` / `formatCurrent` / `formatPercent`
  / `formatAngle`. `formatDistance` auto-scales short→long (`m→km`, `ft→mi`/`nm`).

The **number** is locale-aware (decimal separator / grouping via the i18n
`formatNumber`); the unit **symbol** (`m`, `ft`, `kt`, `°C`, …) is
locale-independent per common GCS/aviation convention.

## Notes

- Imperial defaults: altitude `ft`, distance `ft`/`mi`, speed `mph` (pass
  `opts.unit: 'kt'` for aviation), climb `ft/min`, temperature `°F`.
- `opts.withUnit: false` returns just the formatted number; `opts.fractionDigits`
  overrides the per-unit default precision.
