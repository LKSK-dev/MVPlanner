# `data/missionfile` — mission file I/O

Task **T4.9** (spec `plan/04` §4.3, `plan/07` §7.6). Read/write mission files for
the Plan screen and import KML/GPX tracks, built on the storage foundation
(`data/storage` `FileIo`, T0.9). All formats map to/from the frozen
`MissionItem`/`Mission` contract (`src/contracts/microservices.ts`).

## The `MissionItem` ↔ degrees mapping

A `MissionItem` stores latitude/longitude the MAVLink `MISSION_ITEM_INT` way —
**integer degrees × 1e7** in `x`/`y` — while every on-disk format uses **decimal
degrees**. Conversions are integer-exact:

```
x = round(latDeg * 1e7)        latDeg = x / 1e7
y = round(lonDeg * 1e7)        lonDeg = y / 1e7
z = altMetres                  (no scaling)
```

`coords.ts` exposes `degToE7`, `e7ToDeg` and `e7ToDegString` (a drift-free
integer formatter used by the WPL serializer so a parse→serialize round-trip is
byte-exact).

## Supported formats

| Format                 | Ext                            | Read | Write | Notes                                               |
| ---------------------- | ------------------------------ | :--: | :---: | --------------------------------------------------- |
| `QGC WPL 110`          | `.waypoints` `.txt` `.mission` |  ✅  |  ✅   | Tab-separated text, mission items only.             |
| QGroundControl `.plan` | `.plan`                        |  ✅  |  ✅   | JSON: mission + geofence + rally + home.            |
| KML                    | `.kml`                         |  ✅  |   —   | Import track/placemark `<coordinates>` → waypoints. |
| GPX                    | `.gpx`                         |  ✅  |   —   | Import `<trkpt>`/`<rtept>`/`<wpt>` → waypoints.     |

### `QGC WPL 110`

```
QGC WPL 110
INDEX  CURRENT  FRAME  COMMAND  PARAM1  PARAM2  PARAM3  PARAM4  X  Y  Z  AUTOCONTINUE
```

Columns map 1:1 to `MissionItem` (`X`=lat°, `Y`=lon°, `Z`=alt m, `PARAM1..4`=
`params`). Integer columns are written as integers, params/alt as the shortest
round-trippable decimal, lat/lon losslessly from the stored `×1e7` ints, so
`serializeWpl(parseWpl(text)) === text` for files this module produces.

```ts
import { parseWpl, serializeWpl } from '@/data/missionfile';
const mission = parseWpl(text);
const text2 = serializeWpl(mission);
```

### QGroundControl `.plan`

`parsePlan` / `serializePlan` work on the full `PlanFile` structure
(`groundStation`, `firmwareType`, `vehicleType`, `cruiseSpeed`, `hoverSpeed`,
`plannedHomePosition`, `mission`, `fence`, `rally`). Mission items are QGC
`SimpleItem`s whose 7-element `params` array is `[p1..p4, lat°, lon°, alt]`;
`doJumpId` is regenerated as `seq + 1` on write. `buildPlan(mission)` wraps a
bare mission with QGC-required defaults (empty fence/rally, home from the first
item). The parse→serialize→parse round-trip is exact.

```ts
import { parsePlan, serializePlan, buildPlan } from '@/data/missionfile';
const plan = parsePlan(text); // PlanFile (mission + fence + rally)
const text2 = serializePlan(plan);
const text3 = serializePlan(buildPlan(mission)); // bare mission → .plan
```

### KML / GPX import (SHOULD)

Read-only. Every coordinate becomes a `MAV_CMD_NAV_WAYPOINT` item
(`MAV_FRAME_GLOBAL_RELATIVE_ALT`, `current=1` on the first item, `autocontinue=1`).
KML stores `lon,lat[,alt]`; GPX uses `lat`/`lon` attributes + optional `<ele>`.
Missing altitudes use `ImportOptions.defaultAlt` (default `0`). Only the ordered
coordinates are extracted — areas/overlays/styling are discarded.

```ts
import { importKml, importGpx } from '@/data/missionfile';
const m1 = importKml(kmlText, { defaultAlt: 50 });
const m2 = importGpx(gpxText);
```

## Disk load/save (`FileIo`)

```ts
import { loadMissionFile, saveMission, savePlanFile } from '@/data/missionfile';

const loaded = await loadMissionFile(fileIo); // { name, format, mission, plan? } | undefined
await saveMission(fileIo, mission, 'wpl'); // or 'plan' (wraps via buildPlan)
await savePlanFile(fileIo, plan, 'survey.plan'); // full plan incl. fence + rally
```

`loadMissionFile` auto-detects the format with `detectFormat(name, content)`:
the extension is authoritative for `.waypoints`/`.mission`/`.plan`/`.kml`/`.gpx`;
`.txt` and unknown extensions fall back to a content sniff (`QGC WPL` header,
`"fileType":"Plan"`, `<kml`, `<gpx`).

## Owned files

- `coords.ts` — `×1e7`↔degree conversions, number formatting, MAV constants.
- `wpl.ts` — `parseWpl` / `serializeWpl`.
- `plan.ts` — `parsePlan` / `serializePlan` / `buildPlan`.
- `importers.ts` — `importKml` / `importGpx` (via `DOMParser`).
- `fileio.ts` — `detectFormat`, `loadMissionFile`, `saveMission`, `savePlanFile`.
- `types.ts` — `PlanFile`, `LoadedMission`, `MissionFileFormat`, … .
- `index.ts` — public barrel.

## Limits / residual risks

- **`.plan` items**: only `SimpleItem` is supported; `ComplexItem` (survey
  patterns) and other QGC item types throw. `current` is not part of the `.plan`
  model, so it is `0` after a `.plan` round-trip.
- **`.plan` fence/rally** model the QGC-native `geoFence`/`rallyPoints` shapes;
  they are **not** converted to/from `MISSION_TYPE_FENCE`/`_RALLY` `MissionItem`
  arrays (that bridge lives with the mission microservice / editors).
- **KML/GPX** import handles default-namespaced documents and the common
  geometry tags; prefixed namespaces, nested folders, time/extensions and
  non-track geometry are not interpreted beyond their coordinates.

## How to test

```sh
export npm_config_cache="$PWD/.npm-cache"
npx vitest run test/unit/missionfile.test.ts
npx eslint src/data/missionfile test/unit/missionfile.test.ts
```
