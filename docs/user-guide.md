# User guide

A tour of MVPlanner's six screens and the cross-cutting features that tie them
together. New here? Start with [Getting started](getting-started.md) first.

MVPlanner adapts to the **detected vehicle** — Copter, Plane (incl. QuadPlane),
Rover/Boat, Sub, and Antenna Tracker. Modes, setup steps, tuning parameters, and
mission commands all change to match; unknown types fall back to a generic
MAVLink view.

## Cross-cutting UX

These work everywhere:

- **Command palette** (`Ctrl/Cmd-K`) — search and run any action or jump to any
  screen.
- **Notifications & alert center** — toasts plus a persistent, severity-colored
  log of alerts.
- **Dockable panels & workspaces** — rearrange, split, float, and save layouts;
  pop HUD/map/inspector out into their own windows.
- **Units & coordinate formats** — metric/imperial and DD/DMS/UTM/MGRS apply
  consistently across the HUD, map, and parameter editors (set in
  [Config → Settings](#settings)).
- **Keyboard & touch** — documented shortcuts plus touch support.

---

## Flight screen

The live-operations screen, mirroring Mission Planner's Flight Data tab. The
default layout composes the HUD, map, instrument rail, actions bar, status
messages, and quick-watch; all are dockable and the HUD/map dominance can be
swapped.

### HUD (artificial horizon)

GPU/canvas rendered at up to 60 fps, themeable, resizable, and detachable. Shows
attitude (pitch/roll), heading tape, airspeed/groundspeed, altitude (relative +
AMSL), climb rate, throttle %, AoA/side-slip where available, battery, GPS
status, EKF/vibration indicators, flight mode, armed state, time, and a
STATUSTEXT ticker.

### Map

The primary situational view:

- **Overlays:** vehicle icon (heading + trail), home, mission path, geofence,
  rally points, and the live track.
- **Basemaps:** multiple raster/vector basemaps, **offline cached tiles**,
  custom XYZ/WMS sources, and area prefetch.
- **Tools:** measure distance/area, drop a guided **"fly here"** target, set
  **ROI**, set home, and draw temporary markers.

### Instruments & gauges

Configurable cards: attitude, compass, VSI, airspeed, battery (V/A/Wh/%), GPS,
EKF status, vibration, RC inputs/outputs, system status, link/RSSI, and current
waypoint / distance / ETA. Pick which gauges to show.

### Actions (quick commands)

Arm/Disarm (with pre-arm checks), Takeoff (altitude prompt), Land, RTL, Loiter,
Auto (start mission), Pause/Resume, vehicle-aware Mode change, Set current WP,
Guided **go here / change altitude / change speed**, Set/Clear ROI, Restart
mission, and Emergency stop / motor kill.

Destructive actions require **confirmation** (stronger when armed/in-air) and are
**disabled when unsafe**. Every command, parameter write, and mission upload is
recorded to the **action audit log** with its origin and result.

### Status messages

A console of STATUSTEXT messages with severity coloring, backed by the
persistent alert center and announced through a screen-reader live region.

### Quick-watch

Pick any live numeric field(s) to watch as chips, each with a tiny live
sparkline (mini-plot).

### Joystick, voice, ADS-B (where available)

- **Joystick / gamepad** (`SHOULD`): map a gamepad to `RC_CHANNELS_OVERRIDE` /
  `MANUAL_CONTROL` with per-axis mapping/expo/trim/deadzone and button→action
  bindings. A prominent "manual control active" indicator is shown and control
  fails safe on focus loss.
- **Voice / audio** (`SHOULD`): spoken + tonal alerts (Web Speech API) for mode
  changes, failsafes, low battery, and EKF/GPS loss; configurable and mutable.
- **ADS-B** (`SHOULD`): render `ADSB_VEHICLE` traffic on the map (display only).

These are availability-gated; if a feature is not present in your build it is
simply not shown.

---

## Plan screen

Mission planning, mirroring Mission Planner's Plan tab. Composes a map canvas, a
waypoint table, a tool rail, a command drawer, an elevation profile, and
upload/download controls with progress and read-back verify.

### Waypoints

Create and edit ordered waypoints by **map click** or **table entry**; drag to
move; insert/delete/reorder. The waypoint table is spreadsheet-like with
editable lat/lng/alt, per-command parameters, and altitude **frame**
(relative / AMSL / terrain), a default altitude, and running distance/time
totals. Undo/redo is supported, and map and table stay in sync.

The full **MAV_CMD** palette is available with metadata-driven per-command
editors: `NAV_WAYPOINT`, `LOITER_*`, `RTL`, `LAND`, `TAKEOFF`, the `DO_*`
commands, conditionals, jumps, speed/ROI, camera triggers, servo/relay, and
more — with correct labels and units from the dialect.

### Survey / grid

Draw a polygon and auto-generate a lawn-mower **grid** with a camera/sensor
model, overlap/sidelap, altitude/GSD, grid angle, and entry/exit. Photo-count,
area, and time estimates are shown.

### Geofence

Inclusion/exclusion **polygons and circles** with min/max altitude and a breach
action; uploaded via the mission protocol (`MISSION_TYPE_FENCE`).

### Rally points

Add and edit **rally points** and upload them (`MISSION_TYPE_RALLY`).

### Terrain following

Sample elevation along the path, render a **terrain profile** chart, warn on
collisions, and support terrain-frame altitudes. MVPlanner can also serve
`TERRAIN_REQUEST`/`DATA` to the vehicle.

### Upload / download & files

- **Upload/Download** mission, fence, and rally to/from the vehicle with
  progress and optional read-back verification.
- **Save/Load** missions to disk: `.waypoints`/`.txt` (QGC WPL 110) and `.plan`
  (QGroundControl JSON). KML/GPX **import** is supported.

Two ready-to-load examples live in [`docs/samples/`](samples/).

---

## Setup screen

The initial-setup wizard (mirroring Mission Planner's Initial Setup), with a
left step list, completion tracking, and right-hand wizard panes. Steps and
options adapt to the vehicle class.

- **Frame type/class** — Copter frames, Plane/Rover types (written via params).
- **Accelerometer** — 6-point + level calibration with live orientation
  guidance.
- **Compass** — onboard `MAG_CAL` with live progress and fitness/offsets,
  declination/orientation, and large-vehicle/relax options.
- **Radio (RC)** — live channel bars, min/max capture, reversal, trims.
- **Flight modes** — map RC switch positions to vehicle-aware modes;
  simple/super-simple flags.
- **Failsafe** — RC, battery (V/mAh), GCS, and EKF/GPS thresholds + actions.
- **Battery monitor** (`SHOULD`) — monitor type, voltage/current pins, dividers,
  capacity, and power-module presets.
- **ESC calibration & motor test** (`SHOULD`) — per-motor, ordered, throttle %,
  strongly safety-gated (prop/armed warnings, confirmations).

> **Firmware flashing is not in v1.** MVPlanner reads and displays board type
> and firmware version (`AUTOPILOT_VERSION`) but does not flash firmware.

---

## Config screen

Configuration and tuning, mirroring Mission Planner's Config/Tuning tab.

### Parameter workbench

The flagship parameter manager:

- Fetch the **complete** parameter set (progress + missing-index retry; uses the
  param-FTP fast path when available).
- **Flat list + grouped tree** views with fast search/filter.
- **Type-aware editors** (int/float/bitmask/enum) driven by metadata — units,
  ranges, increments, descriptions, reboot-required flags.
- Write **single / changed / all**; modified and out-of-range values are
  highlighted; refresh on demand.
- **Compare/diff** two sets (vehicle vs file vs another vehicle).
- Save/load **`.param`/`.parm`** files and named **presets** (partial sets) with
  apply/diff.

### Tuning

Per-vehicle **PID configuration tables** (roll/pitch/yaw rate & angle, pos/vel,
altitude) with grouping and tooltips. Extended-tuning sliders, channel-6 tuning,
and autotune controls, plus a live setpoint-vs-actual mini-plot, are provided
where applicable (`SHOULD`).

### Settings

App-wide settings (persisted, take effect everywhere):

- **Units** (metric/imperial) and **coordinate format**.
- **Theme** (Dark/Light/High-contrast/Field) and **language**.
- **Map sources/keys**, **telemetry rates**, **safety confirmations**, **audio**.
- A **Storage Manager** (usage / clear / export) and a **Network egress** list so
  any opt-in network destinations are visible.

---

## Logs screen

Telemetry and DataFlash log analysis, with a source picker, plotter, map track,
inspector, and message sender.

### Open logs

- **DataFlash `.bin`/`.log`** — download from the vehicle (list, select, chunked
  download with resume; via the log protocol or FTP) or open a local file. Large
  logs are decoded by streaming in the Log Worker (no full in-memory load).
- **tlog** — open a recorded telemetry log for playback.

### Plotter

A multi-axis time-series **plotter** (zoom/pan/cursor with readout). Add series
from the message/field tree, enter **derived expressions**, and see
mode/event/error markers. Huge logs are downsampled for smooth interaction.

### Map track & cursor sync

The flight track is drawn from log GPS/POS. Scrub the plot and the map marker
moves; move the map cursor and the plot cursor follows.

### Playback

Open a tlog and **scrub/seek/speed (0.1×–32×)/pause/step**; playback drives the
full UI (HUD/map/instruments) through the replay transport. **Preset analyses**
(vibration, EKF, battery, GPS, PID setpoint-vs-actual) render common views.

### CSV export

Export selected series to **CSV**, and convert/extract tlog message streams.

### Message sender

A metadata-driven **message/command sender**: pick any message or `MAV_CMD` from
dialect metadata, fill fields (enum dropdowns/units), send v1/v2,
signed/unsigned, and save templated favorites. Includes `SET_MESSAGE_INTERVAL`
rate controls. The **MAVLink inspector** (live message tree per sysid/compid,
observed Hz, last-seen, search, raw/hex view, signing/CRC status) is alongside.

---

## Sim & Dev Tools screen

A tabbed developer hub:

- **SITL / Connect** — guidance and recipes for connecting to ArduPilot/PX4
  **SITL** via the WebSocket/TCP bridge (see [Connectivity](connectivity.md)).
- **Extensions manager** — install/import (file/drag/URL), enable/disable/reload
  extensions, review and revoke permissions.
- **Scripting console** — a real code editor (syntax highlight, autocomplete from
  the API types, history, top-level `await`) exposing the `mvp.*` API for live
  automation, debugging, and teaching. Save snippets/macros and bind them to
  commands/shortcuts/buttons or run-on-event.
- **API reference** — browsable, in-app docs of the public extension API.

See **[Extensions & scripting](extensions.md)** for the full tutorial.

---

## Antenna tracker (where available)

MVPlanner can connect to and configure an **antenna tracker** (`SHOULD`), show
its pointing, and feed it the active vehicle's position.
