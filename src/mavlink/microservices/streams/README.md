# Stream / rate management (T1.11)

`StreamRateService` asks the vehicle to emit the MAVLink messages the GCS needs,
at modest rates. Spec: `plan/03` §3.3 (stream/rate management) and §3.4
(Heartbeat — GCS heartbeat is the worker host's job; this service is the
rate-request side).

## Contract

```
createStreamRateService({ send, targetSystem?, targetComponent?, useLegacyDataStream?, dialect? })

setMessageRate(msgId, hz)   -> COMMAND_LONG, command=511 (MAV_CMD_SET_MESSAGE_INTERVAL),
                               param1=msgId, param2=round(1e6/hz) µs  (hz===0 -> 0 = default)
disableMessage(msgId)       -> COMMAND_LONG, param2=-1 (stop the message)
requestDataStream(id, hz,   -> REQUEST_DATA_STREAM (msg 66), req_stream_id=id,
                 start=true)    req_message_rate=hz, start_stop=1|0   (legacy fallback)
requestDefaultSet()         -> a sensible live-ops set at ~4 Hz (see below)
```

- `send(name, fields)` is **injected** (bound by the caller to e.g. the worker
  host's `sendMessage`) so the service never imports the worker/host and is
  unit-testable. It may be sync or async; the service awaits it.
- Message ids, the `MAV_CMD_SET_MESSAGE_INTERVAL` value, and `MAV_DATA_STREAM`
  ids are resolved from a `DialectTable` (bundled `common` by default), not
  hard-coded.

### COMMAND_LONG / SET_MESSAGE_INTERVAL mapping

| field              | value                                                   |
| ------------------ | ------------------------------------------------------- |
| `command`          | `511` (`MAV_CMD_SET_MESSAGE_INTERVAL`)                  |
| `param1`           | message id                                              |
| `param2`           | interval µs: `round(1e6/hz)`; `0`=default; `-1`=disable |
| `param3..param7`   | `0`                                                     |
| `target_system`    | option `targetSystem` (default `1`)                     |
| `target_component` | option `targetComponent` (default `1`)                  |
| `confirmation`     | `0`                                                     |

### REQUEST_DATA_STREAM mapping (legacy fallback)

| field              | value                                  |
| ------------------ | -------------------------------------- |
| `target_system`    | option `targetSystem` (default `1`)    |
| `target_component` | option `targetComponent` (default `1`) |
| `req_stream_id`    | `MAV_DATA_STREAM` value                |
| `req_message_rate` | Hz                                     |
| `start_stop`       | `1` (start) / `0` (stop)               |

### Default live-ops set (`requestDefaultSet`, ~4 Hz)

`SYS_STATUS`, `ATTITUDE`, `GLOBAL_POSITION_INT`, `GPS_RAW_INT`, `VFR_HUD`,
`RC_CHANNELS`, `BATTERY_STATUS`, `MISSION_CURRENT`. `HEARTBEAT` is vehicle-driven
and intentionally omitted. With `useLegacyDataStream`, the same coverage is
requested via the `EXTENDED_STATUS` / `POSITION` / `EXTRA1` / `EXTRA2` /
`RC_CHANNELS` stream groups.

> **Not in M1:** adaptive-by-visible-UI throttling and hidden-tab back-off
> (`plan/03` §3.3) are a documented future refinement. This service only does the
> default request on connect plus the explicit `setMessageRate` / `disableMessage`
> API.

## Integration

`src/transport/manager/connection-manager.ts` instantiates the service (bound to
its host's `sendMessage`) on the transition to `open` and calls
`requestDefaultSet()` exactly once per open session; it is cleared on `closed`.

## Owned files

- `stream-rate-service.ts` — the service.
- `index.ts` — public exports.

## Testing

`test/unit/streams.test.ts` (mock `send`): asserts the `COMMAND_LONG` /
`REQUEST_DATA_STREAM` param mapping, the default-set composition, and that
`ConnectionManager` triggers `requestDefaultSet` exactly once on open and not on
close.
