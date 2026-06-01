# `geo/mission` — mission editing model (T4.2)

Spec: `plan/04` §4.3 (waypoints, full MAV_CMD palette, altitude frames,
distance/time estimates). Pure, dependency-light (`contracts` + import-only
`mavlink/dialects`), DOM-free, fully unit-tested.

## What it is

A mutable-friendly **editing model** on top of the FROZEN wire `Mission` /
`MissionItem` contracts. The wire item stores geographic position as
`MISSION_ITEM_INT`-style scaled integers (`x`/`y` = degrees × 1e7); the model
stores plain **WGS84 degrees** (`lat`/`lon`) so table/map editors never juggle
the scale factor. `z`/`alt` is metres for global frames.

```ts
interface MissionItemModel {
  command: number; // MAV_CMD id (16 = NAV_WAYPOINT)
  frame: number; // MAV_FRAME (6 = GLOBAL_RELATIVE_ALT_INT)
  params: [number, number, number, number]; // param1..param4
  lat: number;
  lon: number; // degrees
  alt: number; // z (metres for global frames)
  autocontinue: boolean;
}
interface MissionModel {
  type: 'mission' | 'fence' | 'rally';
  items: readonly MissionItemModel[]; // index === wire seq
  defaultAlt: number; // metres, for new waypoints
  defaultFrame: number; // MAV_FRAME, for new waypoints
  currentSeq: number; // active item (wire current = 1)
}
```

## Model API (for T4.3 / T4.4)

All ops are **pure** — they return a new `MissionModel`, never mutate:

- `createMission(type?, { defaultAlt?, defaultFrame? })` — empty model.
- `addWaypoint(model, { lat, lon }, opts?)` — append a NAV waypoint with the
  model defaults (`opts` can override command/alt/frame/params/autocontinue).
- `makeWaypoint(model, point, opts?)` — build an item without inserting it.
- `insertItem(model, at, item)` / `deleteItem(model, index)` /
  `reorder(model, from, to)` / `setItem(model, index, patch)` — edit ops; all
  clamp indices and keep `currentSeq` pointing at the same logical item.
- `setDefaultAlt(model, alt)` / `setDefaultFrame(model, frame)` /
  `setCurrent(model, index)`.

### Estimates

`estimateMission(model, { cruiseSpeedMps? })` → `{ distanceM, timeS,
waypointCount }`. Distance is the great-circle (haversine) sum over the ordered
**position** waypoints (commands whose dialect metadata gives `x`/`y` a
latitude/longitude, with a built-in NAV fallback set); all-zero "null island"
positions are skipped. Time is `distanceM ÷ cruiseSpeedMps` (default 5 m/s).

### Altitude frames (`./frames`)

Semantic `AltFrame` ↔ `MAV_FRAME`:

| `AltFrame` | `MAV_FRAME`                         | value |
| ---------- | ----------------------------------- | ----- |
| `relative` | `GLOBAL_RELATIVE_ALT_INT` (default) | 6     |
| `amsl`     | `GLOBAL_INT`                        | 5     |
| `terrain`  | `GLOBAL_TERRAIN_ALT`                | 10    |

`mavFrameToAltFrame` also accepts the non-`INT` AMSL frame (0) and terrain-`INT`
(11); unknown frames degrade to `relative`.

### Command catalog (`./commands`)

`defaultCommandCatalog()` / `buildCommandCatalog(dialects)` →
`Map<value, MavCmdMeta>` with `{ value, name, shortName, description?, category
('NAV'|'DO'|'CONDITION'|'OTHER'), params (7 labels), hasPosition }`, built from
the dialect `MAV_CMD` enum metadata. The command editor widget (`ui/widgets/
cmd-editor`) renders from the same catalog.

### Model ↔ contracts (`./convert`)

`missionFromWire(mission)` / `missionToWire(model)` and the item-level
`itemFromWire` / `itemToWire` apply the **1e7** `LATLON_SCALE`. `seq` is the
array index; `current = 1` lands on `currentSeq`.

## How to test

`test/unit/mission-model.test.ts` — add/insert/delete/reorder, distance + time
estimates for a known waypoint list, frame mapping, and the model↔`MissionItem`
1e7 round-trip.
