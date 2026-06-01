# `ui/screens/setup/frame` — Frame/type setup step (T5.3)

Exports `createFrameStep(deps)` for the setup `WizardShell` registry.

```ts
const step = createFrameStep({
  params: paramClient,
  getVehicleClass: () => activeVehicle.vehicleClass,
});
```

## API

- `deps.params` — `ParamClient` used to `get`, `fetchAll`, `set`, and subscribe
  with `onChange`.
- `deps.getVehicleClass()` — returns the current `VehicleClass` so the step can
  choose vehicle-aware frame parameters.

## Parameter mapping

- Copter: editable selectors for `FRAME_CLASS` and `FRAME_TYPE`.
  - `FRAME_CLASS`: Quad=1, Hexa=2, Octo=3, OctoQuad=4, Y6=5, Tri=7,
    Single=10, Coax=11, BiCopter=12, Heli=13, Heli_Dual=14, Heli_Quad=15,
    DodecaHexa=16, HeliQuad=17.
  - `FRAME_TYPE`: Plus=0, X=1, V=2, H=3, V-Tail=4, A-Tail=5, Y6B=10,
    Y6F=11, BetaFlightX=12, DJIX=13, ClockwiseX=14.
- Plane: depends on `Q_ENABLE` (the ArduPlane QuadPlane/VTOL master switch).
  - QuadPlane (`Q_ENABLE = 1`): editable selectors for `Q_FRAME_CLASS` and
    `Q_FRAME_TYPE` (same UX as Copter).
    - `Q_FRAME_CLASS` (ArduPlane `@Values`): Quad=1, Hexa=2, Octa=3,
      OctaQuad=4, Y6=5, Tri=7, Tailsitter=10, DodecaHexa=12, Deca=14.
      `0:Undefined` and the scripting matrices (15, 17) are intentionally not
      offered as selectable values.
    - `Q_FRAME_TYPE` shares the AP_Motors geometry enum with Copter
      `FRAME_TYPE` (Plus=0, X=1, V=2, H=3, …).
  - Fixed-wing (`Q_ENABLE` off/absent): no multirotor frame exists; the step
    reports `na` and points the user at servo-function setup
    (`SERVOn_FUNCTION`) rather than showing an empty selector. Enable the
    QuadPlane stack (`Q_ENABLE = 1`) in the parameter editor to configure a
    VTOL frame.
- Rover/Boat: displays current `FRAME_CLASS` when present and points to params.
- Sub: displays current `FRAME_CONFIG` when present and points to params.

The step status accessor returns `done` when the current class-like parameter is
present and valid for the known table (for Copter, a known `FRAME_CLASS` value;
for a QuadPlane, a known `Q_FRAME_CLASS` value), `na` for a fixed-wing plane
(`Q_ENABLE` off — nothing to configure here), otherwise `todo`.

## Tests

- `test/unit/setup-frame-options.test.ts` covers pure option tables and
  selection derivation.
- `test/unit/setup-frame-widget.test.ts` mounts the step with a mock
  `ParamClient` and verifies Copter selectors, writes, and current values.
