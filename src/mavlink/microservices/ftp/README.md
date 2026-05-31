# MAVLink FTP microservice — list + read (T3.1)

`FtpClient` implements the `list` + `read` halves of the frozen `FtpClient`
contract (`src/contracts/microservices.ts`) over `FILE_TRANSFER_PROTOCOL`
(msg id **110**). Spec: `plan/03` §3.4 (**MAVLink FTP**). Built in M3 because the
param-FTP fast path (`@PARAM/param.pck`) and later log/calibration paths reuse
it. `write`/`remove` and burst-read robustness are completed in **T5.11**.

## Contract

```
createFtpClient({ sendMessage, onMessage, target, clock?, timeoutMs?,
                  maxRetries?, chunkSize? })

list(path)                       -> Promise<FtpEntry[]>
read(path, onProgress?, signal?) -> Promise<Uint8Array>
write(path, data, signal?)       -> rejects FtpError('not-implemented')  // T5.11
remove(path)                     -> rejects FtpError('not-implemented')  // T5.11
dispose()                        -> void   // extra: unsubscribe + drop in-flight
```

- `sendMessage(name, fields)` and `onMessage(names, cb)` are **injected** (bound
  by the caller to the worker host's `sendMessage` / `onMessage`) so the client
  never imports the worker and is fully unit-testable. `onMessage` is subscribed
  once to `['FILE_TRANSFER_PROTOCOL']` for the client's lifetime.
- `target` = `{ network, system, component }` — the FTP peer (vehicle sysid +
  autopilot compid). Outgoing frames set `target_*`; replies are correlated only
  if they come from that `system`/`component`.
- `clock.setTimeout(handler, ms) -> cancel` abstracts timers so retries/timeouts
  are driven by a deterministic fake clock in tests; default uses host timers.
- `timeoutMs` (default **800**), `maxRetries` (default **4**, i.e. up to 5
  sends), `chunkSize` (default **239** = `FTP_MAX_DATA`).

## Wire payload (`ftp-protocol.ts`)

`FILE_TRANSFER_PROTOCOL.payload` is a fixed 251-byte little-endian struct:

| off | field            | type     |
| --- | ---------------- | -------- |
| 0   | `seq`            | u16 LE   |
| 2   | `session`        | u8       |
| 3   | `opcode`         | u8       |
| 4   | `size`           | u8       |
| 5   | `req_opcode`     | u8       |
| 6   | `burst_complete` | u8       |
| 7   | `padding`        | u8       |
| 8   | `offset`         | u32 LE   |
| 12  | `data`           | u8[≤239] |

Opcodes: `TerminateSession=1`, `ResetSessions=2`, `ListDirectory=3`,
`OpenFileRO=4`, `ReadFile=5`, `BurstReadFile=15`, `Ack=128`, `Nak=129`. A NAK
carries its error code in `data[0]`; `EndOfFile=6` is a normal terminator, not a
failure. The codec delivers `payload` as a `number[]`; `encodePayload` /
`decodePayload` convert to/from the typed struct.

## Transaction state machine

`transact(req, signal?)` owns exactly **one** in-flight request at a time
(operations are awaited serially):

1. Reserve a fresh **seq pair** (`this.seq += 2`), send the FTP payload, and
   schedule a `timeoutMs` timer.
2. Replies are correlated by `reply.seq === request.seq + 1` **and** source
   `sysid`/`compid` == `target`. Mismatches are ignored (stale/duplicate/other
   peer). Both `Ack` and `Nak` resolve the transaction (the caller interprets
   NAK codes); only timeout / abort / send-failure reject.
3. On timeout the **identical** frame is resent (same seq) up to `maxRetries`;
   exhaustion rejects `FtpError('timeout')`. `signal` abort rejects
   `FtpError('aborted')` immediately.

Reserving a unique seq pair per transaction means a late reply from a previous
(timed-out/aborted) request can never alias a later one.

### `list(path)`

Pages `ListDirectory` by **entry offset**: send with `data = utf8(path)` and the
running entry `offset`; each `Ack.data` is a run of NUL-terminated records
(`F<name>\t<size>` file, `D<name>` dir, `S…`/other = skip). Advance `offset` by
the record count (skips included) and repeat until a NAK `EndOfFile` (or an
empty page). Skips are counted but not surfaced.

### `read(path, onProgress?, signal?)`

`OpenFileRO` (`Ack.session` = the session, `Ack.data` = u32 LE file size) → a
loop of sequential `ReadFile`s by byte `offset` (`chunkSize` bytes each),
appending `Ack.data` until a NAK `EndOfFile` (or a short/empty chunk) →
`TerminateSession` (best-effort, in a `finally`). `onProgress(done, total)`
reports bytes so far against the reported file size (falling back to `done`).
Returns the concatenated `Uint8Array`.

`FtpError` carries `{ reason: 'timeout' | 'aborted' | 'nak' | 'send-failed' |
'protocol' | 'not-implemented', nak? }`.

## Owned files

- `ftp-protocol.ts` — wire constants, opcodes/NAK codes, payload encode/decode.
- `ftp-client.ts` — the client, injected seams, transaction machine, `FtpError`.
- `index.ts` — public exports.

## Testing

`test/unit/ftp.test.ts` (mock host + fake clock): payload codec round-trip;
multi-chunk read by offset → exact bytes; progress vs file size; short/empty
final chunk EOF; non-EOF NAK rejects; directory listing with paging + skips;
timeout→retry→resolve and timeout→reject; seq + system/component correlation;
abort cancels; `write`/`remove` reject as not-implemented.

> **Not in scope here (T5.11):** `write`/`remove`, burst read (`BurstReadFile`)
> robustness, and `ResetSessions` recovery. **Not here:** SITL integration (the
> milestone gate) and the param-FTP fast path consumer (T3.2).
