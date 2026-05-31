# `src/vehicle` — Vehicle model + mode maps (task T1.5)

Derives a typed `VehicleState` per `(sysid, compid)` from decoded MAVLink.
Spec: `plan/03` §3.3 (vehicle model), `plan/04` §4.11 (vehicle-type awareness);
conventions `plan/implementation/00` §0.3.

This module is **internal**: it implements no frozen contract interface. It
consumes the FROZEN `DecodedMessage` **type** and produces the FROZEN
`VehicleState` shape (`src/contracts`), so it builds and tests against synthetic
`DecodedMessage` objects with no codec/transport dependency.

## What it does

`VehicleModel.ingest(msg)` folds each relevant message into the matching
vehicle's state:

| Message               | Derives                                                                    |
| --------------------- | -------------------------------------------------------------------------- |
| `HEARTBEAT`           | `mavType`, `autopilot`, `vehicleClass`, `armed`, `mode`, `lastHeartbeatMs` |
| `GLOBAL_POSITION_INT` | `position` (lat/lon 1e-7°, alt/relAlt mm→m), `velocity` (ground/climb)     |
| `VFR_HUD`             | `velocity` ground/air/climb (refinement)                                   |
| `ATTITUDE`            | `attitude` roll/pitch/yaw (rad)                                            |
| `SYS_STATUS`          | `battery` (mV→V, cA→A, %), `ekfOk` (AHRS health bit)                       |
| `BATTERY_STATUS`      | `battery` refinement (cell0 mV→V, cA→A, consumed mAh, %)                   |
| `GPS_RAW_INT`         | `gps` fix / sats / hdop (eph/100)                                          |
| `EKF_STATUS_REPORT`   | `ekfOk` (attitude + horiz vel + horiz pos, not uninitialised)              |
| `HOME_POSITION`       | `home` lat/lon (1e-7°), alt (mm→m)                                         |
| `AUTOPILOT_VERSION`   | `firmware` (`flight_sw_version` → `major.minor.patch`)                     |
| `VIBRATION`           | `vibe` x/y/z                                                               |

Other messages are ignored (no vehicle is created for them). Memory is **bounded**
by the number of distinct `(sysid, compid)` systems — no per-vehicle history.

### Flight-mode decode (`mode-maps.ts`)

`HEARTBEAT.custom_mode` is decoded per `vehicleClass` + `autopilot`:

- **ArduPilot** (`MAV_AUTOPILOT_ARDUPILOTMEGA`, 3): per-class tables —
  `COPTER` / `PLANE` (incl. QuadPlane) / `ROVER` (also `boat`) / `SUB` /
  `TRACKER`. Mode numbers are pinned from ArduPilot's `*_mode` enums.
- **PX4** (`MAV_AUTOPILOT_PX4`, 12): best-effort decode of the packed
  `custom_mode` (main byte at bits 16–23, AUTO sub byte at 24–31), e.g.
  `AUTO.RTL`; numeric fallback when the main byte is zero/unknown.
- Unknown class / autopilot, or an unmapped value → the numeric `custom_mode`
  as a string (spec §4.11 generic-view degradation).

`MAV_TYPE` → `VehicleClass`: multirotor + heli/coaxial/dodeca → `copter`;
fixed-wing + all VTOL variants → `plane`; rover → `rover`, boat → `boat`,
submarine → `sub`, antenna tracker → `tracker`; everything else → `unknown`.

The maps live in `mode-maps.ts` (pure data + pure decode fns) so the canonical
values are easy to verify/extend against firmware without touching the model.

### Link stats are NOT owned here

`VehicleState.link` (`LinkStats`) is owned by the transport + registry. This
model defaults it to zeros; the **worker host (T1.9)** fills it from the registry
before publishing to the UI.

## Public API (`VehicleModel`)

```
ingest(msg, nowMs?)        // fold one DecodedMessage into vehicle state
getState(sysid, compid)    // VehicleState | undefined (snapshot copy)
listVehicles()             // VehicleState[] (sorted by sysid, compid)
snapshot()                 // alias of listVehicles()
onChange(listener)         // subscribe; returns an unsubscribe fn
clear()                    // drop all vehicle state
```

The clock is injectable (`new VehicleModel({ clock })`) and `ingest` accepts an
explicit `nowMs`, so timestamps are deterministic in tests. `getState` /
`snapshot` / `onChange` hand out copies — callers cannot mutate internal state.

Pure mode helpers are also exported: `classifyMavType`, `decodeMode`,
`decodePx4Mode`, and the raw tables (`COPTER_MODES`, `PLANE_MODES`, …).

## Owned files

| File           | Responsibility                                           |
| -------------- | -------------------------------------------------------- |
| `mode-maps.ts` | `MAV_TYPE`→class + per-class/PX4 mode tables & decoders. |
| `model.ts`     | `VehicleModel` — ingest + per-`(sysid,compid)` state.    |
| `index.ts`     | Public barrel.                                           |

## Tests

`test/unit/vehicle.test.ts` — class mapping per `MAV_TYPE`, armed on/off, pinned
copter/plane/rover/sub/tracker mode decodes, PX4 main/sub-mode decode, unknown→
numeric fallback, and field derivation from synthetic `GLOBAL_POSITION_INT` /
`VFR_HUD` / `ATTITUDE` / `SYS_STATUS` / `BATTERY_STATUS` / `GPS_RAW_INT` /
`EKF_STATUS_REPORT` / `HOME_POSITION` / `AUTOPILOT_VERSION` / `VIBRATION`, plus
clock injection, change notifications, and snapshot-copy isolation.

```sh
export npm_config_cache="$PWD/.npm-cache"
npx vitest run test/unit/vehicle.test.ts
npx eslint src/vehicle test/unit/vehicle.test.ts
```
