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
- Plane: displays current `Q_FRAME_CLASS` / `Q_FRAME_TYPE` when present and
  points the user to the parameter editor instead of inventing a simplified UI.
- Rover/Boat: displays current `FRAME_CLASS` when present and points to params.
- Sub: displays current `FRAME_CONFIG` when present and points to params.

The step status accessor returns `done` when the current class-like parameter is
present and valid for the known table (for Copter, a known `FRAME_CLASS` value),
otherwise `todo`.

## Tests

- `test/unit/setup-frame-options.test.ts` covers pure option tables and
  selection derivation.
- `test/unit/setup-frame-widget.test.ts` mounts the step with a mock
  `ParamClient` and verifies Copter selectors, writes, and current values.
