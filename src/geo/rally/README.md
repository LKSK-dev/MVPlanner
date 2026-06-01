# `geo/rally` — rally-points model + wire mapping (T4.7)

Spec: `plan/04` §4.3 (Rally points); work-breakdown `plan/implementation/03`
§T4.7.

Pure, dependency-free, DOM-free **rally-points model** for the Plan screen. A
`Rally` is an ordered list of rally points (a safe return/loiter location the
vehicle can divert to) layered on the FROZEN wire `Mission` / `MissionItem`
contracts for `MISSION_TYPE_RALLY`. Round-trips losslessly through
`MAV_CMD_NAV_RALLY_POINT` items and is unit-tested — see
`test/unit/rally-convert.test.ts`.

## Model

```ts
interface RallyPoint {
  lat: number; // WGS84 degrees
  lon: number; // WGS84 degrees
  alt: number; // metres (relative-alt frame)
  breakAlt?: number; // metres — begin landing sequence
  landDir?: number; // degrees — desired landing heading
  flags?: number; // RALLY_FLAGS bitmask
}
interface Rally {
  points: readonly RallyPoint[];
  defaultAlt: number;
}
```

- **Edit ops** (`model.ts`, all pure/immutable): `createRally`, `addRallyPoint`,
  `insertRallyPoint`, `deleteRallyPoint`, `setRallyPoint` (pass an extra as
  `undefined` to clear it), `reorderRally`, `setDefaultAlt`, `makeRallyPoint`.

## Wire mapping (`convert.ts`)

Each rally point becomes one `MISSION_ITEM_INT`-style item with
`command = MAV_CMD_NAV_RALLY_POINT` (`5100`):

```text
x  = round(lat × 1e7)      // MISSION_ITEM_INT scaled degrees
y  = round(lon × 1e7)
z  = alt                   // metres, frame MAV_FRAME_GLOBAL_RELATIVE_ALT (3)
param1 = breakAlt ?? 0     // ArduPilot RALLY_POINT extras, preserved for round-trip
param2 = landDir  ?? 0
param3 = flags    ?? 0
```

- **`rallyToMission(rally)` → `Mission`** (`type: 'rally'`) — for upload via the
  mission service / `MissionClient` (the Plan assembly owns the upload).
- **`rallyFromMission(mission)` → `Rally`** — read-back; non-`NAV_RALLY_POINT`
  items are ignored so a stray command can never be misread. Optional extras are
  only set when their param is non-zero, so a point with no extras round-trips
  back to no extras.
- **`rallyPointToItem` / `rallyPointFromItem`** — per-point helpers.
- Scale helpers `degToScaled` / `scaledToDeg`; flags `RALLY_FLAG_FAVORABLE_WIND`,
  `RALLY_FLAG_LAND_IMMEDIATELY`.

ArduPilot's mission-protocol rally conversion conveys lat/lng/alt in the item;
this module additionally preserves the legacy `RALLY_POINT` extras
(break/land-dir/flags) in `param1..param3` for a fuller round-trip.

## Owned files

`types.ts`, `convert.ts`, `model.ts`, `index.ts`, `README.md`.
