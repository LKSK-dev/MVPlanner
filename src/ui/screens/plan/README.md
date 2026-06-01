# `ui/screens/plan` — Flight Plan screen (T4.10)

Spec: `plan/04` §4.3, `plan/05` §5.4 Plan. The M4 keystone: composes the plan
widgets into the Plan layout and owns the shared plan state.

## Layout

- Top **transfer toolbar**: verify toggle, Upload/Download mission, Upload
  fence/rally, Open file, Save `.waypoints` / `.plan`, live status.
- Body row: left **tool rail** (`./tool-rail`), dominant **map** (`MapWidget` +
  the `./map-edit` controller + measure tools), right **side** = waypoint table
  (`./table`) above a tabbed editor **drawer** (`./fence` · `./rally` ·
  `./survey`).
- Bottom **terrain profile** (`./terrain`).

## Shared signals (one per kind)

`PlanScreen` owns `mission` (`MissionModel`), `fence` (`Fence`), `rally`
(`Rally`) and the survey polygon as Solid signals. The **table**, the **map
editor** and the **fence/rally/survey panels** all read+write these same signals
(the table is controlled via `model()`/`onChange`; the fence/rally panels accept
a controlled `value`/`model` accessor), so a table edit and a map edit — or a
downloaded mission / opened file — stay in sync.

## Transfers

Uploads/downloads use the app/connection-scoped `MissionClient`
(`flight/services.ts`): `upload(missionToWire(model), { verify, onProgress })`,
`download('mission')`, plus `fenceToMission` / `rallyToMission` for the fence /
rally types. Fence upload also writes the `FENCE_*` params via the `ParamClient`.
The terrain profile samples the injected `ElevationProvider` along the path; the
`TerrainService` (registered in `flight/services.ts`) serves `TERRAIN_DATA`.

## Registration

`createPlanScreenPanel({ services, t })` builds the real `screen.plan`
`PanelDef`; `App` installs it via `setScreenPanel('plan', …)` before the shell
renders. Tested in `test/unit/plan-screen.test.ts` (composition, tool switching,
upload path, map⇄table sync, shell mount). Live SITL upload/read-back is the M4
gate (orchestrator-owned).
