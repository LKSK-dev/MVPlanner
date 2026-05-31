# `ui/widgets/map/layers` + `ui/widgets/map/tools` — Map overlays & tools (T2.4)

Spec: `plan/04` §4.2 (vehicle/home/track/measure/markers/guided), `plan/04` §4.3
(display of mission/fence/rally geometry). Builds on the committed raster
`MapEngine` (T2.3) — these modules **import** the engine seam only; they never
touch `engine.ts`/`map.tsx`.

## What this is

The engine runs every registered `MapLayer.render(ctx)` once per frame with a
`MapRenderCtx` (`src/contracts/map.ts`):

```ts
interface MapRenderCtx {
  project(lat: number, lon: number): [number, number]; // → device-pixel canvas point
  canvas: HTMLCanvasElement;
}
```

This task adds the **overlay layers** and the **map tools** that draw on top of
the basemap tiles via that seam. Add a layer with `engine.addLayer(layer)`
(returns a disposer); mutate its backing data and call `engine.requestRedraw()`.

## Layer set + data-accessor API

Every layer is a factory taking a **pure, injectable `DataAccessor<T> = () => T |
undefined`** and visual options. A layer never reads a store: the Flight screen
(T2.11) maps `VehicleState`/`Mission`/fence/rally into the small overlay shapes
in `./types` and passes a `() => data` getter (a Solid accessor in the app, any
closure in tests). Draw-nothing when the accessor returns `undefined`/empty.

| Layer                           | Factory                     | Accessor shape                                          | Kind          |
| ------------------------------- | --------------------------- | ------------------------------------------------------- | ------------- |
| Vehicle marker + heading vector | `createVehicleLayer(data)`  | `VehicleOverlay` `{ lat, lon, headingDeg, courseDeg? }` | live          |
| Home marker                     | `createHomeLayer(data)`     | `LatLon`                                                | live          |
| Live track polyline             | `createTrackLayer(data)`    | `readonly LatLon[]`                                     | live          |
| Mission path + waypoints        | `createMissionLayer(data)`  | `MissionOverlay`                                        | scaffold (M4) |
| Geofence polys/circles          | `createGeofenceLayer(data)` | `GeofenceOverlay`                                       | scaffold (M4) |
| Rally points                    | `createRallyLayer(data)`    | `RallyOverlay`                                          | scaffold (M4) |

**How T2.11 wires the live layers** (sketch):

```ts
import {
  createVehicleLayer,
  createHomeLayer,
  createTrackLayer,
  createTrackRing,
} from 'ui/widgets/map/layers';

const ring = createTrackRing({ capacity: 4000, minSpacingM: 2 });
createEffect(() => {
  const p = vehicle().position;
  if (p) {
    ring.push(p);
    engine.requestRedraw();
  }
});

engine.addLayer(
  createVehicleLayer(() => {
    const v = vehicle();
    const p = v.position;
    if (!p) return undefined;
    return {
      lat: p.lat,
      lon: p.lon,
      headingDeg: degFromYaw(v.attitude.yawRad),
      courseDeg: v.courseDeg,
    };
  }),
);
engine.addLayer(createHomeLayer(() => vehicle().home));
engine.addLayer(createTrackLayer(() => ring.points()));
```

**Scaffold layers** accept the same accessor and render only when data is
present; M4 (T4.x) feeds real mission/fence/rally without touching this code.

## Map tools + click-intent surface (`../tools`)

`createMapTools(engine, opts)` (the deferred T2.3 tools) owns **one**
`engine.on('click')` subscription and a render layer, and routes each tap by the
active `ToolMode`:

- `measure-distance` / `measure-area` → append a point; running great-circle
  **distance** / spherical **area** update (`measureDistanceM()` /
  `measureAreaM2()` / a localized `measureSummary()` for the map `aria-live`
  region).
- `drop-marker` → place a temporary `MapMarker`.
- `none` (default) → the click is relayed as a **map click intent**
  (`onClickIntent(cb)` + `latestClick()`) for the Flight screen/actions
  (T2.7/T2.11) to consume for guided "fly here" / set-ROI. **No `CommandClient`
  is imported here** — the controller only emits lat/lon; command wiring is T2.7.

`mode()/setMode()`, `undoLastPoint()`, `clearMeasure()`, `markers()`,
`removeMarker()/clearMarkers()`, `onChange(cb)` (mirror into a signal) and
`dispose()` round out the surface. Entering a measure tool starts a fresh
measurement; markers persist across mode changes.

## Pure-tested vs canvas-deferred

- **Pure (`test/unit/map-layers.test.ts`, `map-layers-tools.test.ts`)** — the
  icon transform (`vehicleIconPolygon`), heading vector (`headingVectorEnd`),
  track decimation (`decimateTrack`) + ring (`createTrackRing`), great-circle
  distance (`haversineMeters`/`pathLengthMeters`), spherical area
  (`polygonAreaMeters2`), radius→pixel (`radiusToPixels`), `projectPath`, the
  formatters, every layer's **`project()` usage** (asserted with a spy +
  null-context `MapRenderCtx`), and the full tools state machine (mode routing,
  measure accumulation, markers, click intents).
- **Canvas-deferred (`./draw`)** — the imperative `stroke`/`fill`/`arc` calls.
  Under happy-dom `getContext('2d')` is `null`, so each `render` computes its
  geometry (always calling `project`) and bails before drawing; a recording stub
  context smokes the call sequence. Real pixels are validated by the e2e/perf rig
  at the M2 gate.

## Owned files

`src/ui/widgets/map/layers/**` (`geometry.ts`, `track-ring.ts`, `types.ts`,
`draw.ts`, `messages.ts`, `vehicle.ts`, `home.ts`, `track.ts`, `mission.ts`,
`fence.ts`, `rally.ts`, `index.ts`, this README), `src/ui/widgets/map/tools/**`
(`tools.ts`, `index.ts`), and `test/unit/map-layers*.test.ts`. The core engine
(`engine.ts`/`map.tsx`) and the widget barrel (`index.ts`) are **not** modified —
the Flight/Plan screens import these via the deep barrels
`ui/widgets/map/layers` and `ui/widgets/map/tools`.

## i18n

`mapoverlay.*` strings are contributed at import time via `registerMessages` in
`./messages` — no central catalog edit. The measure/marker readouts are written
for the map's `aria-live` region so SR users get the tool feedback.
