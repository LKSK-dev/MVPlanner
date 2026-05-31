# Command microservice + mode/arm (T2.5 + T2.6)

`CommandClient` implements the frozen `CommandClient` contract
(`src/contracts/microservices.ts`): the `COMMAND_LONG` / `COMMAND_INT` ↔
`COMMAND_ACK` request/ack microservice with retry-until-ack and `IN_PROGRESS`
handling, plus the high-level arm / mode / takeoff / land / RTL / guided / ROI /
set-current-WP helpers. Spec: `plan/03` §3.4 (**Command** and **Mode/Arm**),
`plan/04` §4.11 (mode maps).

## Contract

```
createCommandClient({ sendMessage, onMessage, getActiveVehicle, clock?,
                      maxAttempts?, resendMs?, progressTimeoutMs? })

send(cmd, params, opts?)  -> Promise<{ result: MAV_RESULT, progressPct? }>
arm(arm, force?)          -> Promise<void>
setMode(mode)             -> Promise<void>
takeoff(altM)             -> Promise<void>
land()                    -> Promise<void>
rtl()                     -> Promise<void>
guidedGoto(lat, lon, altM)-> Promise<void>
setRoi(lat, lon, altM)    -> Promise<void>
clearRoi()                -> Promise<void>
setCurrentWp(seq)         -> Promise<void>
dispose()                 -> void   // extra: unsubscribe + reject in-flight
```

- `sendMessage(name, fields)` and `onMessage(names, cb)` are **injected**
  (bound by the caller to the worker host's `sendMessage` / `onMessage`) so the
  client never imports the worker and is fully unit-testable. `onMessage` is
  subscribed once to `['COMMAND_ACK']` for the client's lifetime.
- `getActiveVehicle()` returns `{ sysid, compid, vehicleClass }` (a
  `VehicleState` satisfies it). `send`/helpers reject with a typed
  `CommandError('no-vehicle')` when there is no active vehicle.
- `clock.setTimeout(handler, ms) -> cancel` abstracts timers so retries/timeouts
  are driven by a deterministic fake clock in tests; the default uses the host
  `setTimeout`/`clearTimeout`.
- Message / command / enum ids are resolved from the bundled `common`
  `DialectTable` (`constants.ts`) with the frozen MAVLink literal as fallback.

## Command / ACK correlation + retry

1. `send` resolves the active vehicle, builds a `COMMAND_LONG` (or `COMMAND_INT`
   when `opts.int`), transmits it, and schedules a resend timer (`resendMs`,
   default 1000 ms).
2. Each resend increments the `COMMAND_LONG.confirmation` count. After
   `maxAttempts` transmits (default 5) with no ACK, the command rejects with
   `CommandError('timeout')`.
3. Incoming `COMMAND_ACK` is correlated by **command id** + **source vehicle**
   (`msg.sysid`, preferring matching `compid`). ACKs from other vehicles or for
   other commands are ignored.
4. `MAV_RESULT`:
   - `ACCEPTED (0)` → resolve `{ result, progressPct? }`.
   - `IN_PROGRESS (5)` → stay pending, record `progressPct`, extend the deadline
     by `progressTimeoutMs` (default 5000 ms); **no resend**. A terminal ACK
     completes it; otherwise it rejects `timeout`.
   - `TEMPORARILY_REJECTED (1)` → transient: the resend timer keeps running.
   - `DENIED (2)` / `UNSUPPORTED (3)` / `FAILED (4)` / `*_ONLY (7/8)` → reject
     `CommandError('rejected', result)`.
5. `opts.signal` (AbortSignal) cancels a pending command immediately
   (`CommandError('aborted')`), cancelling the timer and stopping resends.

`CommandError` carries `{ reason: 'no-vehicle' | 'aborted' | 'timeout' |
'rejected' | 'send-failed', command, result? }`.

## Exact cmd / param mappings

| Helper                     | Wire                                                                          | Key params                                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `arm(a, force)`            | `COMMAND_LONG` cmd **400** `MAV_CMD_COMPONENT_ARM_DISARM`                     | `param1 = a?1:0`, `param2 = force?21196:0`                                                                                                                                           |
| `setMode(mode)`            | `COMMAND_LONG` cmd **176** `MAV_CMD_DO_SET_MODE`                              | `param1 = 1` (`CUSTOM_MODE_ENABLED`), `param2 = custom_mode` (reverse mode-map for the active class); fallback `SET_MODE` (msg **11**) `base_mode=1`, `custom_mode` on `UNSUPPORTED` |
| `takeoff(altM)`            | `COMMAND_LONG` cmd **22** `MAV_CMD_NAV_TAKEOFF`                               | `param7 = altM`                                                                                                                                                                      |
| `land()`                   | copter → `setMode('LAND')`; else `COMMAND_LONG` cmd **21** `MAV_CMD_NAV_LAND` | land in place                                                                                                                                                                        |
| `rtl()`                    | `setMode('RTL')`                                                              | —                                                                                                                                                                                    |
| `guidedGoto(lat,lon,altM)` | `SET_POSITION_TARGET_GLOBAL_INT` (msg **86**)                                 | `coordinate_frame = 6` (`GLOBAL_RELATIVE_ALT_INT`), `lat_int/lon_int = round(deg*1e7)`, `alt = altM`, `type_mask` = position-only (vel/accel/yaw/yaw_rate ignored); no ACK           |
| `setRoi(lat,lon,altM)`     | `COMMAND_INT` cmd **195** `MAV_CMD_DO_SET_ROI_LOCATION`                       | `frame = 0` (`GLOBAL`), `x/y = round(deg*1e7)`, `z = altM`                                                                                                                           |
| `clearRoi()`               | `COMMAND_LONG` cmd **197** `MAV_CMD_DO_SET_ROI_NONE`                          | —                                                                                                                                                                                    |
| `setCurrentWp(seq)`        | `MISSION_SET_CURRENT` (msg **41**)                                            | `seq`; no ACK                                                                                                                                                                        |

`send(cmd, params, { int })`: `params[0..3]` → `param1..param4`; for `COMMAND_INT`
`params[4]`/`params[5]` are the **pre-scaled** integer `x`/`y` and `params[6]`
is `z`; for `COMMAND_LONG` `params[4..6]` → `param5..param7`.

### Mode maps

`custom_mode` is reverse-resolved from the per-class ArduPilot tables in
`src/vehicle/mode-maps` (`arduMapForClass`). E.g. `AUTO` = copter **3**, plane
**10**, rover **10**; `GUIDED` = copter **4**, plane **15**. Unknown mode names
(or an unknown vehicle class) reject with `CommandError('rejected')`.

## Owned files

- `command-client.ts` — the client, injected seams, `CommandError`.
- `constants.ts` — cmd / message / enum ids (resolved from `common`).
- `index.ts` — public exports.

## Testing

`test/unit/command.test.ts` (mock host + fake clock): arm encodes cmd 400 p1=1;
retry-until-ACK then resolve ACCEPTED; timeout after N attempts; DENIED/FAILED
reject; IN_PROGRESS stays pending then completes (and stalls → timeout);
`setMode('AUTO')` per class (copter 3 / plane 10 / rover 10) and the SET_MODE
fallback; `guidedGoto` scales lat/lon; `setRoi` COMMAND_INT scaling; AbortSignal
cancels; no-vehicle rejects.

> **Not in scope here:** SITL integration (the milestone gate), the actions-bar
> confirmation + audit-log gating (T2.7), and joystick/manual control (T8.6).
