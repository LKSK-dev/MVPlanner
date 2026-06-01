# Calibration microservice (T5.1)

Implements the frozen `CalibrationClient` contract using injected seams:

- `command.send(cmd, params, opts)` for ACK-bound `MAV_CMD_*` sends.
- `onMessage(names, cb)` for unthrottled `STATUSTEXT`, `MAG_CAL_*`, and `RC_CHANNELS` taps.
- `getTarget()` to filter inbound messages to the active vehicle system id.
- `clock` for bounded compass report waits.

## Commands and messages

Constants are resolved from bundled dialect tables (`ardupilotmega`, then `common`) with MAVLink literal fallbacks:

- `MAV_CMD_PREFLIGHT_CALIBRATION` = `241`
  - gyro: `[1,0,0,0,0,0,0]`
  - level: `[0,0,0,0,2,0,0]`
  - accel 6-point start: `[0,0,0,0,1,0,0]`
- `MAV_CMD_ACCELCAL_VEHICLE_POS` = `42429`
  - faces in order: `LEVEL=1`, `LEFT=2`, `RIGHT=3`, `NOSEDOWN=4`, `NOSEUP=5`, `BACK=6`
- `MAV_CMD_DO_START_MAG_CAL` = `42424` with `[0,0,1,0,0,0,0]` (all compasses, autosave)
- `MAV_CMD_DO_CANCEL_MAG_CAL` = `42426` on compass abort
- `MAG_CAL_PROGRESS` = `191`
- `MAG_CAL_REPORT` = `192`
- `STATUSTEXT` = `253`
- `RC_CHANNELS` = `65`

`MAV_CMD_DO_ACCEPT_MAG_CAL` (`42425`) is exported, but the current flow does not send it because start uses `autosave=1`.

## Flow notes

- `accel6Point(step, signal)` starts full accel calibration, then waits for `step(face)` before sending each face position command. `STATUSTEXT` is observed for accel failure/abort text, but UI gating remains the source of truth for advancing faces.
- `compass(onProgress, signal)` reports `MAG_CAL_PROGRESS.completion_pct` and resolves offsets from a successful `MAG_CAL_REPORT`. Failure statuses (`FAILED`, `BAD_ORIENTATION`, `BAD_RADIUS`) reject. Abort sends best-effort cancel.
- `radio(onChannels, signal)` streams `RC_CHANNELS.chan*_raw` until the signal aborts, then resolves. UI code owns min/max capture and `RCx_MIN/MAX` writes.

Known residual firmware differences: accel prompt text is ArduPilot-oriented and only failure/abort text is interpreted; PX4 calibration flows may require different messages/commands.
