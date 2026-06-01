# `geo/fence` — geofence model + mission conversion (T4.6)

Spec: `plan/04` §4.3 (Geofence); work-breakdown `plan/implementation/03` §T4.6.

Dependency-free, DOM-free geofence model layered on the FROZEN
`MISSION_TYPE_FENCE` wire contracts. A `Fence` is a list of inclusion/exclusion
**polygons** (vertex lists) and **circles** (centre + radius), an optional
**return point**, plus the non-spatial **min/max altitude** and **breach action**
(which ArduPilot stores as `FENCE_*` _parameters_, not mission items). The
model ↔ items conversion is pure and round-trippable — see
`test/unit/fence.test.ts`.

## Model

```ts
interface Fence {
  shapes: FenceShape[]; // ordered inclusion/exclusion polygons + circles
  returnPoint?: LatLon; // NAV_FENCE_RETURN_POINT
  minAltM: number; // FENCE_ALT_MIN
  maxAltM: number; // FENCE_ALT_MAX
  breachAction: number; // FENCE_ACTION
}
type FenceShape =
  | { kind: 'polygon'; inclusion: 'inclusion' | 'exclusion'; vertices: LatLon[] }
  | { kind: 'circle'; inclusion: 'inclusion' | 'exclusion'; center: LatLon; radiusM: number };
```

Positions are plain WGS84 **degrees**; the `1e7` mission scale is applied only in
`convert.ts` (reusing `geo/mission`'s `degToScaled`/`scaledToDeg`). Map vertex
drawing is owned by the map editor (T4.4), so a freshly `addPolygon`'d polygon
starts empty.

### Edit ops (`model.ts`) — all pure, returning a new `Fence`

`createFence`, `addPolygon`, `addCircle`, `addShape`, `removeShape`, `setShape`,
`setCircleRadius`, `setInclusion`, `setReturnPoint`, `setMinAlt`, `setMaxAlt`,
`setBreachAction`, and `fenceParams(fence)` → the `FENCE_*` name/value pairs the
Plan assembly writes via the parameter service.

## `MISSION_TYPE_FENCE` MAV_CMD mapping (`convert.ts`)

| Element       | `MAV_CMD`                            | id   | `param1`           | `x`/`y` (1e7)  |
| ------------- | ------------------------------------ | ---- | ------------------ | -------------- |
| Return point  | `NAV_FENCE_RETURN_POINT`             | 5000 | —                  | point lat/lon  |
| Incl. polygon | `NAV_FENCE_POLYGON_VERTEX_INCLUSION` | 5001 | total vertex count | vertex lat/lon |
| Excl. polygon | `NAV_FENCE_POLYGON_VERTEX_EXCLUSION` | 5002 | total vertex count | vertex lat/lon |
| Incl. circle  | `NAV_FENCE_CIRCLE_INCLUSION`         | 5003 | radius (m)         | centre lat/lon |
| Excl. circle  | `NAV_FENCE_CIRCLE_EXCLUSION`         | 5004 | radius (m)         | centre lat/lon |

- `fenceToMission(fence)` → `Mission{ type:'fence' }`. Order: return point (if
  any), then each shape in list order. A polygon emits **one item per vertex**,
  each tagged with the polygon's vertex count in `param1`. Empty polygons and
  non-positive-radius circles are skipped (no valid wire encoding). Items use
  `MAV_FRAME_GLOBAL` (0); `seq` is the item index.
- `fenceFromMission(mission, opts?)` → `Fence`. Polygon vertices are grouped by
  consuming `param1` consecutive same-command items. Altitude limits + breach
  action are not in the item stream, so they seed from `opts`/defaults.

## Caveats

- Min/max altitude + breach action do **not** round-trip through the item stream
  (they are `FENCE_*` params); `fenceFromMission` reconstructs only geometry.
- Empty polygons (no vertices) are dropped by `fenceToMission`.

## Owned files

`types.ts`, `commands.ts`, `convert.ts`, `model.ts`, `index.ts`, `README.md`.
