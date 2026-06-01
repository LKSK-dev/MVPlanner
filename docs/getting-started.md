# Getting started

This guide takes you from "I have `MVPlanner.html`" to a first simulated flight
and a tour of the six screens. It takes about 10 minutes with SITL.

> **TL;DR:** Open `MVPlanner.html` in Chrome/Edge → connect over Web Serial
> (USB/radio) **or** the companion bridge to SITL → arm, take off, RTL.

## 1. Open the app

MVPlanner is a single self-contained `MVPlanner.html` file. There is nothing to
install.

- **Easiest:** double-click `MVPlanner.html` — it opens over `file://` and runs
  fully offline.
- **Self-hosted:** serve the file over `http(s)://` (any static file server). A
  secure context (`https://` or `localhost`) is recommended because some browser
  features prefer it.

### Use Chrome or Edge

The direct hardware transports — **Web Serial** (USB/telemetry radio),
**Web Bluetooth**, and **WebUSB** — are only available in Chromium-based
browsers (**Chrome / Edge / Opera ≥ 110**).

- **Firefox / Safari** can still run the full UI, plan missions, analyze logs,
  and connect through the **WebSocket bridge** — they just cannot open a serial
  port directly.
- MVPlanner detects your browser's capabilities at runtime and tells you which
  transports are available, so you are never left guessing.

See the [browser support matrix](connectivity.md#browser-support) for details.

## 2. Connect to a vehicle

Open the **connection drawer** (top bar). Pick a transport, fill in its config,
and connect. Link state, data rate, packet loss, RSSI, and signing status are
shown live once connected.

### Option A — real vehicle over Web Serial (Chrome/Edge)

1. Plug in your USB cable or telemetry radio.
2. Choose the **Serial** transport.
3. Click connect; the browser shows a port picker — choose your device.
4. Set the **baud rate** (telemetry radios are commonly `57600`; USB direct is
   commonly `115200`).
5. Connect. The vehicle and MAVLink version are auto-detected; if multiple
   vehicles are present, use the active-vehicle selector.

### Option B — SITL (or any TCP/UDP endpoint) over the bridge

Browsers cannot open raw TCP/UDP sockets, so connecting to **SITL**,
`mavlink-router`, or `mavproxy` uses the tiny optional
[companion bridge](../bridge/README.md). It is **not** part of `MVPlanner.html`
and is never required for the Web Serial path.

1. Start SITL so it exposes TCP `5760` (ArduPilot does this by default):

   ```sh
   # ArduPilot Copter example:
   sim_vehicle.py -v ArduCopter --map --console
   #   ... SITL now listens on tcp:127.0.0.1:5760
   ```

2. Run the bridge, pointing it at SITL's TCP port:

   ```sh
   cd bridge
   npm install
   node bridge.mjs --ws-port 14550 --tcp 127.0.0.1:5760
   ```

3. In MVPlanner, choose the **WebSocket** transport and connect to
   `ws://127.0.0.1:14550`.

The bridge binds loopback only by default. If you ever expose it beyond your own
machine, read its [security notes](connectivity.md#security-notes) first.

## 3. Your first flight (in SITL)

Once connected to SITL, go to the **Flight** screen. You should see the HUD come
alive (attitude, heading, speeds, altitude) and the vehicle icon on the map.

From the **Actions** bar:

1. **Arm** — confirm the prompt. Watch the armed indicator.
2. **Takeoff** — enter a target altitude (e.g. `30 m`) and confirm. The HUD
   altitude climbs.
3. Watch the **map** track and **instruments** update; try a **Guided "go here"**
   by clicking the map.
4. **RTL** (Return to Launch) — the vehicle flies home and lands.

Destructive actions (arm, takeoff, mode change, motor commands) always ask for
confirmation, and the confirmation is stronger when the vehicle is armed or in
the air. Every command is written to the **action audit log**.

> SITL is the safest place to learn the workflow. Do exactly the same steps on a
> real vehicle once you are comfortable — props off for first arms.

## 4. Where the six screens are

Switch screens from the top bar (or the command palette — `Ctrl/Cmd-K`):

| Screen              | Use it to…                                                                 |
| ------------------- | -------------------------------------------------------------------------- |
| **Flight**          | Fly: HUD, map, instruments, quick actions, status messages.                |
| **Plan**            | Build/upload/download missions, surveys, geofences, rally points, terrain. |
| **Setup**           | Calibrate and configure a new vehicle (frame, sensors, radio, modes, FS).  |
| **Config**          | Edit parameters, tune PIDs, change app settings.                           |
| **Logs**            | Open `.bin`/tlog files, plot, view the map track, export CSV, play back.   |
| **Sim & Dev Tools** | SITL connect help, extensions manager, scripting console, API reference.   |

Panels are dockable and rearrangeable, and layouts/workspaces can be saved.
Many panels (HUD, map, inspector) can pop out into their own window.

## 5. Try a sample mission

Want a mission to play with? On the **Plan** screen, load one of the bundled
samples in [`docs/samples/`](samples/):

- [`copter-survey-loop.waypoints`](samples/copter-survey-loop.waypoints) — QGC
  WPL 110 text format.
- [`copter-survey-loop.plan`](samples/copter-survey-loop.plan) — QGroundControl
  `.plan` JSON (mission + a geofence circle + a rally point).

Both describe the same simple Copter mission near the ArduPilot default home
(Canberra): takeoff → a few waypoints → RTL. Load it, then **upload** it to SITL
and switch to **Auto** to fly it.

## Next steps

- **[User guide](user-guide.md)** — a full tour of every screen and feature.
- **[Connectivity](connectivity.md)** — all transports and the bridge in depth.
- **[Extensions & scripting](extensions.md)** — automate and extend MVPlanner.
