# MVPlanner

> Open one HTML file, plug in a telemetry radio, and you are flying.

MVPlanner is a modern, browser-based **MAVLink ground control station** — a
reimagining of ArduPilot **Mission Planner** that ships as a single
`MVPlanner.html` file. No installer, no runtime, no server, no platform
lock-in. Open it in a browser, connect to your vehicle, and fly.

It is MAVLink-native (v1/v2, signing, all standard microservices) and
vehicle-agnostic — Copter, Plane (incl. QuadPlane), Rover/Boat, Sub, and
Antenna Tracker; ArduPilot first, PX4 compatible.

## Why single-file?

The release artifact is **one self-contained `MVPlanner.html`**: all JavaScript,
CSS, workers, fonts, and icons are inlined. That means:

- **Zero install.** Double-click the file (or self-host it) and it runs offline.
- **Portable & auditable.** One file to copy to a field laptop, archive, or
  review. No background services, no phone-home; all data stays local by
  default and network egress is opt-in and visible.
- **Fast.** GPU-accelerated HUD/map, web workers for MAVLink/log/map work, and a
  tight size budget.

## Quick start

1. **Get `MVPlanner.html`** — download a release artifact or build it yourself
   (see [Building](#building)).
2. **Open it in Chrome or Edge** (≥ 110). Either double-click it (`file://`) or
   self-host it over `http(s)://`. Chrome/Edge/Opera are required for the direct
   **Web Serial / Bluetooth / USB** transports; Firefox/Safari can still use the
   WebSocket bridge and all offline/log-analysis features.
3. **Connect:**
   - **USB / telemetry radio** → Web Serial (Chrome/Edge), pick the port + baud.
   - **SITL or a network endpoint** → run the optional
     [companion bridge](bridge/README.md) and connect over WebSocket.
4. **Fly.** In SITL: arm, take off, watch the HUD/map, then RTL.

The full walkthrough is in **[docs/getting-started.md](docs/getting-started.md)**.

## Documentation

| Guide                                        | What it covers                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Getting started](docs/getting-started.md)   | Open the app, connect (Web Serial or bridge→SITL), first SITL flight, the 6 screens. |
| [User guide](docs/user-guide.md)             | Every screen: Flight, Plan, Setup, Config, Logs, Sim & Dev Tools.                    |
| [Connectivity](docs/connectivity.md)         | Transports, the companion bridge, security notes, browser support matrix.            |
| [Extensions & scripting](docs/extensions.md) | The `mvp`/`ctx` API tutorial, the 7 bundled examples, the scripting console.         |
| [Sample missions](docs/samples/)             | A ready-to-load `.waypoints` and `.plan` you can open on the Plan screen.            |

## The six screens

- **Flight** — live HUD, map, instruments, quick actions, status messages.
- **Plan** — waypoints, survey/grid, geofence, rally, terrain; upload/download
  and file save/load.
- **Setup** — frame, accel/compass/radio calibration, flight modes, failsafes,
  battery, motors.
- **Config** — parameter workbench, PID/tuning tables, app settings.
- **Logs** — open `.bin`/tlog, plot, map track, CSV export, playback, message
  sender.
- **Sim & Dev Tools** — SITL connect help, extensions manager, scripting
  console, API reference.

## Building

MVPlanner builds to a single file with Vite:

```sh
npm install
npm run build      # -> dist/MVPlanner.html (single, self-contained file)
```

Other useful scripts:

```sh
npm run dev          # dev server with HMR
npm test             # unit/integration tests (Vitest)
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm run check:size   # enforce the single-file size budget
```

The build inlines all assets and injects a strict CSP; `scripts/postbuild.mjs`
finishes the single-file artifact. Open `dist/MVPlanner.html` directly to verify
it works offline.

## Companion bridge (optional)

Browsers cannot open raw TCP/UDP sockets, so to reach SITL (`tcp:5760`),
`mavlink-router`, or `mavproxy`, MVPlanner connects through a tiny optional
WebSocket↔socket bridge. **It is never bundled into `MVPlanner.html`** and is
never required for the Web Serial / Bluetooth / USB paths. See
[bridge/README.md](bridge/README.md).

## Scope notes (v1)

- **Firmware flashing is not in v1.** Bootloader/DFU flashing was deferred to a
  later release. MVPlanner still reads and displays board type and firmware
  version (`AUTOPILOT_VERSION`); it just does not flash firmware.
- **Browser-dependent features degrade gracefully.** Web Serial / Bluetooth /
  USB are Chromium-only today; MVPlanner detects capabilities at runtime and
  guides Firefox/Safari users to the WebSocket bridge or offline/log workflows.
- **Some `SHOULD` features may phase in** (e.g. joystick, voice, ADS-B, antenna
  tracker, MAVLink forwarding). Where present, they are documented in the
  [user guide](docs/user-guide.md).

## License

ISC. Third-party licenses are aggregated in `NOTICES` and shown in the in-app
**About** dialog.
