# Flight modes setup step (T5.7)

`createModesStep(deps)` contributes a Setup wizard step for ArduPilot flight-mode
mapping. It reads and writes through the injected `ParamClient` only:

- `FLTMODE1` … `FLTMODE6` map the six RC switch positions to numeric mode ids.
- `FLTMODE_CH` selects the RC channel used by the mode switch; the UI displays
  ArduPilot's default channel `5` when the parameter is absent.
- `SIMPLE` and `SUPER_SIMPLE` render as optional per-position bitmask checkboxes
  when those parameters are present in the cache.

Mode dropdown options are vehicle-aware. The pure `modeOptionsForClass` helper
uses `src/vehicle/mode-maps` (`arduMapForClass`) so Copter, Plane, Rover/Boat,
Sub and Tracker show the corresponding ArduPilot numeric mode table. Unknown
vehicle classes degrade to an empty option list and explanatory copy.

The step status is derived from current params: `done` when `FLTMODE_CH` is a
non-disabled channel and at least one `FLTMODEn` value is configured; otherwise
`todo`. Pure derivation lives in `options.ts` for unit tests.
