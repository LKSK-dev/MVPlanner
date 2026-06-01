# Sample missions

Small, valid example missions you can load on MVPlanner's **Plan** screen
(**Load** → pick a file). Both describe the same simple Copter mission near the
ArduPilot default home position (Canberra): **takeoff → four waypoints → RTL**.

| File                                                           | Format                          | Notes                                                      |
| -------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------- |
| [`copter-survey-loop.waypoints`](copter-survey-loop.waypoints) | QGC WPL 110 text (`.waypoints`) | Mission items only (home row + takeoff + WPs + RTL).       |
| [`copter-survey-loop.plan`](copter-survey-loop.plan)           | QGroundControl JSON (`.plan`)   | Mission + one inclusion geofence circle + one rally point. |

Both parse and round-trip through MVPlanner's `data/missionfile` loader
(`parseWpl` / `parsePlan`).

## Try it

1. Open the **Plan** screen and **Load** one of the files above.
2. Review the waypoints in the table / on the map.
3. With SITL connected, **Upload** the mission, then switch to **Auto** to fly
   it. See [Getting started](../getting-started.md) for connecting to SITL.

## Format notes

- **QGC WPL 110** (`.waypoints`/`.txt`) — a `QGC WPL 110` header line followed by
  one tab-separated row per item:
  `INDEX  CURRENT  FRAME  COMMAND  P1  P2  P3  P4  X  Y  Z  AUTOCONTINUE`.
  `X`/`Y` are latitude/longitude in decimal degrees and `Z` is altitude in
  metres. Row 0 is the home item.
- **`.plan`** — a QGroundControl JSON document with `fileType: "Plan"`, a
  `mission` (each item a `SimpleItem` whose 7 `params` are
  `p1..p4, lat, lon, alt`), plus optional `geoFence` and `rallyPoints` sections
  and a `plannedHomePosition`.

Command IDs used here: `22` = `NAV_TAKEOFF`, `16` = `NAV_WAYPOINT`,
`20` = `NAV_RETURN_TO_LAUNCH`; frame `3` = `GLOBAL_RELATIVE_ALT`.
