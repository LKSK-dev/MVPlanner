# `ui/screens/setup/tracker` — Antenna tracker support (T8.9)

Spec: plan/04 §4.12 (SHOULD). Connect to / configure an antenna tracker, show
where it is pointing, and feed it the active vehicle position so it can follow
the aircraft.

## Modules

- `pointing.ts` — pure pointing math. `computePointing(tracker, vehicle)` returns
  `{ azimuthDeg, elevationDeg, distanceM, groundDistanceM }` using great-circle
  bearing + haversine ground distance over a spherical Earth and
  `atan2(Δalt, ground)` elevation. No I/O.
- `config.ts` — the editable tracker parameter table (`TRACKER_CONFIG_FIELDS`:
  `SERVO_YAW_TYPE`, `SERVO_PITCH_TYPE`, `YAW_RANGE`, `PITCH_MIN`, `PITCH_MAX`,
  `DISTANCE_MIN`) and `readTrackerConfig(params)` to snapshot current values from
  a `ParamClient` cache.
- `tracker-service.ts` — `TrackerService`: detection, pointing surface, position
  feed and config, all over injected seams.
- `tracker-panel.tsx` — `TrackerPanel` Solid component: status, compass display,
  feed toggle and config form.
- `messages.ts` — owns the `tracker.*` i18n namespace.

## TrackerService

Constructed with injected host seams so it unit-tests with a mock send + tap and
no worker:

```ts
const service = createTrackerService({
  sendMessage: host.sendMessage, // (name, fields) => void | Promise
  onMessage: (names, cb) => host.onMessage(names, cb),
  getActiveVehicle: () => store.activeVehicle(), // VehicleState | undefined
  params: paramClient, // optional ParamClient
  feedIntervalMs: 1000, // rate-limit (default 1 Hz)
});
```

### Detection

Subscribes to `HEARTBEAT`; a heartbeat with `type === MAV_TYPE_ANTENNA_TRACKER`
(5) latches the tracker `(sysid, compid)` and marks it connected. `connected`
is derived from heartbeat staleness (`connectionTimeoutMs`, default 3 s); the
panel calls `refreshConnection()` on a timer so a silent tracker drops.

### Pointing

Pointing/position messages are accepted **only** from the latched tracker target:

- `ATTITUDE` → actual pan/tilt (`yaw` → azimuth, `pitch` → elevation).
- `NAV_CONTROLLER_OUTPUT` → commanded pointing (`target_bearing`/`nav_bearing` →
  azimuth, `nav_pitch` → elevation).
- `GLOBAL_POSITION_INT` → the tracker's own ground position.

`getState().solution` is the geometric pointing computed from the tracker
position toward the active vehicle's position.

### Position feed

`feedVehiclePosition()` emits a `GLOBAL_POSITION_INT` carrying the active
vehicle's position to the tracker, **rate-limited** to `feedIntervalMs`. It
returns `true` when a message was sent and `false` when skipped (no tracker, no
vehicle position, or called too soon). The panel drives it from a `setInterval`
while the feed toggle is on.

### Config

`getConfig()` snapshots the tracker params from the `ParamClient` cache and
`setConfig(param, value)` writes one through `ParamClient.set`. `canConfigure` is
`false` when no `ParamClient` was injected.

## Tests

- `test/unit/tracker-pointing.test.ts` — azimuth/elevation/distance from known
  geometry.
- `test/unit/tracker-service.test.ts` — detection from a `MAV_TYPE_ANTENNA_TRACKER`
  heartbeat, the rate-limited position feed via a mock send, and config
  read/write via a mock `ParamClient`.
