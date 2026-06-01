# Mission microservice — mission / fence / rally (T4.1)

`MissionClient` implements the frozen `MissionClient` contract
(`src/contracts/microservices.ts`) over the MAVLink `MISSION_*` item-transfer
protocol for **all three** `MAV_MISSION_TYPE`s — `mission` (0), `fence` (1) and
`rally` (2). Spec: `plan/03` §3.4 (**Mission**).

## Contract

```
createMissionClient({ sendMessage, onMessage, getTarget, clock?,
                     resendMs?, maxAttempts? })

download(type, onProgress?, signal?)      -> Promise<Mission>
upload(mission, { verify?, onProgress?, signal? }?) -> Promise<void>
clear(type)                               -> Promise<void>
setCurrent(seq)                           -> Promise<void>
onCurrent(cb)                             -> () => void
onReached(cb)                             -> () => void
dispose()                                 -> void   // extra: unsub + reject in-flight
```

- `sendMessage(name, fields)` and `onMessage(names, cb)` are **injected** (bound
  by the caller to the worker host's `sendMessage` / `onMessage`) so the client
  never imports the worker and is fully unit-testable. `onMessage` is subscribed
  **once** for the client's lifetime to all reply/event messages:
  `MISSION_COUNT`, `MISSION_ITEM_INT`, `MISSION_ACK`, `MISSION_REQUEST_INT`,
  `MISSION_REQUEST`, `MISSION_CURRENT`, `MISSION_ITEM_REACHED`.
- `getTarget()` returns `{ sysid, compid }` (the active vehicle).
  `download`/`upload`/`clear`/`setCurrent` reject (or throw) with
  `MissionError('no-target')` when there is no target.
- `clock.setTimeout(handler, ms) -> cancel` abstracts timers so per-step
  retries/timeouts run under a deterministic fake clock in tests; the default
  uses the host `setTimeout`/`clearTimeout`.
- Message ids and `MAV_MISSION_TYPE` / `MAV_MISSION_RESULT` values are resolved
  from the bundled `common` `DialectTable` (`constants.ts`) with the frozen
  MAVLink literal as fallback.

The frozen `MissionItem` shape (`seq`, `frame`, `command`, `current`,
`autocontinue`, `params[4]`, `x`, `y`, `z`) is preserved verbatim in both
directions. `MISSION_ITEM_INT` carries lat/lon as **1e7-scaled integers** in
`x`/`y` and a float `z`; the caller owns that scaling (mirroring the contract),
so the client passes `x`/`y`/`z` straight through.

## Download state machine (GCS pulls from the vehicle)

1. send `MISSION_REQUEST_LIST(mission_type)`; phase = **count**.
2. on `MISSION_COUNT(count, mission_type)` (matched by `mission_type` + source
   `sysid`): `count == 0` → send `MISSION_ACK` and resolve an empty mission;
   else phase = **items**, request seq 0 with `MISSION_REQUEST_INT`.
3. on `MISSION_ITEM_INT(seq)` for the **expected** seq: record it, fire
   `onProgress(received, count)`, then request the next seq. Out-of-order /
   duplicate items are ignored.
4. when all `count` items are collected: send the terminal `MISSION_ACK` and
   resolve `Mission{ type, items }` (items ordered by seq).
5. **retry:** each step (count wait or current-item wait) is bounded by a
   `resendMs` timer (default 1500 ms); on timeout it **resends the current
   request** (the `REQUEST_LIST` or the current `REQUEST_INT`). After
   `maxAttempts` (default 5) it rejects `MissionError('timeout')`. A dropped item
   therefore just re-requests the same seq.

## Upload state machine (vehicle pulls from the GCS)

1. send `MISSION_COUNT(count, mission_type)`; phase = **count**.
2. answer each inbound `MISSION_REQUEST_INT(seq)` **or** legacy
   `MISSION_REQUEST(seq)` by sending `MISSION_ITEM_INT(seq, mission_type)`; track
   the highest answered seq and fire `onProgress(seq+1, count)`. Out-of-range
   seqs are ignored.
3. on terminal `MISSION_ACK(type)`: `MAV_MISSION_ACCEPTED (0)` resolves; any
   other `MAV_MISSION_RESULT` rejects `MissionError('rejected', result)`.
4. **verify (optional):** after an accepted ACK, re-`download` the same type and
   compare the read-back to the uploaded items; a mismatch rejects
   `MissionError('verify')`. The comparison ignores the `current` flag (the
   vehicle commonly re-flags the active waypoint on read-back) but requires every
   geometry/command field (`seq`, `frame`, `command`, `autocontinue`, `params`,
   `x`, `y`, `z`) to match.
5. **retry:** bounded by `resendMs` / `maxAttempts`. Before any request arrives
   (or for an empty upload) a timeout **resends `MISSION_COUNT`**; once items are
   flowing a timeout **resends the last requested `MISSION_ITEM_INT`**. Exhaustion
   rejects `MissionError('timeout')`.

## clear / setCurrent / events

- `clear(type)` sends `MISSION_CLEAR_ALL(mission_type)` and awaits its
  `MISSION_ACK` (resending on the same `resendMs`/`maxAttempts` bound);
  `ACCEPTED` resolves, any other result rejects `MissionError('rejected')`.
- `setCurrent(seq)` sends `MISSION_SET_CURRENT(seq)` — fire-and-forget, no ACK.
- `onCurrent(cb)` / `onReached(cb)` surface `MISSION_CURRENT.seq` /
  `MISSION_ITEM_REACHED.seq`; each returns an unsubscribe function.

`MissionError` carries `{ reason: 'no-target' | 'aborted' | 'timeout' |
'rejected' | 'send-failed' | 'verify' | 'disposed', result? }`. An `AbortSignal`
rejects a pending download/upload immediately (`'aborted'`).

### MISSION_REQUEST vs MISSION_REQUEST_INT

The client **always sends `MISSION_REQUEST_INT`** when downloading and **always
sends `MISSION_ITEM_INT`** when uploading (the int variants are the modern,
lossless path used by ArduPilot/PX4). It still **answers** an inbound legacy
`MISSION_REQUEST(seq)` (some firmwares request the float item) with a
`MISSION_ITEM_INT` — autopilots accept the int item regardless of which request
they sent. The float-only `MISSION_ITEM` (msg 39) is intentionally **not**
emitted.

## Owned files

- `mission-client.ts` — the client, injected seams, `MissionError`.
- `constants.ts` — message ids + `MAV_MISSION_TYPE` / `MAV_MISSION_RESULT`
  (resolved from `common`).
- `index.ts` — public exports.

## Testing

`test/unit/mission-service.test.ts` (mock host driving the handshake + fake
clock): download `COUNT → ITEM_INTs → ACK` yields the items with progress; empty
mission; item-request retry on a dropped item and the timeout path; upload
`COUNT → REQUEST_INTs → ACK accepted` sends the correct items (and answers the
legacy `MISSION_REQUEST`); upload rejects on an error ACK; `MISSION_COUNT` resend

- timeout; verify re-downloads and compares (ignoring `current`) and rejects on a
  mismatch; fence + rally `mission_type` round-trips; wrong-type `COUNT` ignored;
  `clear` accept/reject; `setCurrent`; `onCurrent`/`onReached` events; no-target
  and pre-aborted guards.

> **Not in scope here:** the mission model + MAV_CMD editors (T4.2), waypoint
> table / map editing (T4.3/T4.4), geofence + rally editors (T4.6/T4.7), mission
> file I/O (T4.9), and SITL integration with loss injection (the milestone gate).
