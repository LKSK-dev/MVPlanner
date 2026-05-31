# Parameter microservice (T3.2)

`ParamClient` implements the frozen `ParamClient` contract
(`src/contracts/microservices.ts`) over the **classic** MAVLink parameter
protocol — the robust primary path. Spec: `plan/03` §3.4 (**Parameters**).

> The **param-FTP fast path** (`@PARAM/param.pck` via MAVLink FTP) is an
> OPTIONAL future enhancement and is **deliberately not implemented here**. The
> classic protocol is correct on every firmware; FTP would only reduce fetch
> latency. It can be layered on later behind the same `fetchAll` once the FTP
> client (T3.1) exposes a stable read API.

## Contract

```
createParamClient({ sendMessage, onMessage, getTarget, clock?,
                    fetchQuietMs?, fetchMaxStallRounds?,
                    setResendMs?, setMaxAttempts?, confirmTolerance? })

fetchAll(onProgress?, signal?) -> Promise<Param[]>   // ordered by param_index
get(name)                      -> Param | undefined  // pure cached lookup
set(name, value)               -> Promise<void>       // confirmed write
onChange(cb)                   -> () => void          // value-change subscription
dispose()                      -> void                // extra: unsub + reject in-flight
```

- `sendMessage(name, fields)` and `onMessage(names, cb)` are **injected** (bound
  by the caller to the worker host's `sendMessage` / `onMessage`) so the client
  never imports the worker and is fully unit-testable. `onMessage` is subscribed
  once to `['PARAM_VALUE']` for the client's lifetime.
- `getTarget()` returns `{ sysid, compid }` (the active vehicle). `fetchAll` /
  `set` reject with `ParamError('no-target')` when there is no target.
- `clock.setTimeout(handler, ms) -> cancel` abstracts timers so the quiet window,
  retries, and timeouts run under a deterministic fake clock in tests; the
  default uses the host `setTimeout` / `clearTimeout`.
- Message ids and `MAV_PARAM_TYPE` values are resolved from the bundled `common`
  `DialectTable` (`constants.ts`) with the frozen MAVLink literal as fallback.

## Value decoding — ArduPilot semantics (primary)

`PARAM_VALUE.param_value` is a `float`. This client follows **ArduPilot**: the
float **is** the numeric value (integer parameters are simply the value cast to
float). `Param.value` is therefore the `param_value` directly and `Param.type`
carries the `MAV_PARAM_TYPE` for type-aware editors.

> **Known difference — PX4.** Older PX4 builds transmit non-float parameters by
> _bytewise-reinterpreting_ the integer's bytes into the `param_value` float
> field (so the receiver must read the 4 raw bytes back as the typed integer).
> ArduPilot is the primary firmware per spec, so the cast-to-float
> interpretation is used. If PX4 byte-reinterpret support is needed, decode
> `Param.value` from the raw bytes of `param_value` according to `param_type`
> at this boundary — the rest of the client is interpretation-agnostic.

On `set`, the wire `param_type` is the **cached** type, defaulting to `REAL32`
when the parameter has never been seen (ArduPilot ignores `param_type` on
`PARAM_SET` and stores by its own table).

## Full fetch with missing-index retry

1. `fetchAll` broadcasts `PARAM_REQUEST_LIST` and collects the streamed
   `PARAM_VALUE`s, keyed by `param_index`. `param_count` (from the first value)
   is the expected `total`; `onProgress(received, total)` fires on every value.
2. Each new value pushes a **quiet-window** timer (`fetchQuietMs`, default
   800 ms) forward — so gap detection waits until the initial burst settles.
3. When the window elapses with the set incomplete, every missing index
   `0..total-1` is re-requested with a targeted `PARAM_REQUEST_READ`
   (`param_index = i`, empty `param_id`). This repeats each window.
4. Completion (`received >= total`) resolves with the params **ordered by
   index**. A window that makes **no** progress increments a stall counter;
   after `fetchMaxStallRounds` (default 12) stalled windows the fetch rejects
   `ParamError('timeout')`. Progress resets the stall counter.
5. If no values arrive at all (`total` still unknown), the window re-broadcasts
   `PARAM_REQUEST_LIST` instead, under the same stall bound.
6. An `AbortSignal` rejects the fetch immediately (`ParamError('aborted')`).

`param_id` is decoded from the `char[16]` field, NUL-trimmed (and clamped to 16
chars when no terminator is present). Values with `param_index == 0xFFFF` (not
list-indexed) are kept as name-keyed extras and appended after the indexed set.

## Confirmed set + change events

1. `set(name, value)` emits `PARAM_SET` (cached/`REAL32` `param_type`) and starts
   a resend timer (`setResendMs`, default 1000 ms).
2. The echoed `PARAM_VALUE` for `name` whose value matches within
   `confirmTolerance` (default `1e-4`, relative for large magnitudes) **confirms**
   the write: the promise resolves, the cache updates, and `onChange(param)`
   fires.
3. After `setMaxAttempts` sends (default 5) with no matching echo, the set
   rejects `ParamError('timeout')`. A failed `sendMessage` rejects
   `ParamError('send-failed')`. A second `set` of the same name supersedes the
   first (`ParamError('aborted')`).

`onChange` also fires for **spontaneous** value changes (a `PARAM_VALUE` that is
new or different from the cache while no fetch is collecting) — e.g. a parameter
changed on the vehicle or by another GCS. Bulk values arriving during a
`fetchAll` do **not** spam `onChange`.

`ParamError` carries `{ reason: 'no-target' | 'aborted' | 'timeout' |
'disposed' | 'send-failed', param? }`.

## Owned files

- `param-client.ts` — the client, injected seams, `ParamError`.
- `constants.ts` — message ids + `MAV_PARAM_TYPE` (resolved from `common`).
- `index.ts` — public exports.

## Testing

`test/unit/param-service.test.ts` (mock host streaming `PARAM_VALUE` + fake
clock): full fetch completes with progress; a **forced** dropped-index stream
re-requests the gaps after the quiet window and then completes; `set` echo
confirms → cache updates → `onChange` fires; fetch/set timeout paths;
`param_id` parsing (16-char, NUL-trim); abort.

> **Not in scope here:** the param-FTP fast path (deferred), parameter metadata
> (units/min/max/enums — T3.3, sibling), the param workbench UI (T3.4), and SITL
> integration (the milestone gate).
