# MAVLink FTP microservice — list/read/write/remove (T3.1 + T5.11)

`FtpClient` implements the frozen `FtpClient` contract
(`src/contracts/microservices.ts`) over `FILE_TRANSFER_PROTOCOL` (msg id **110**).
Spec: `plan/03` §3.4 (**MAVLink FTP**). The T3.1 list/read foundation is kept,
and T5.11 adds write/remove plus robust burst reads.

## Contract

```
createFtpClient({ sendMessage, onMessage, target, clock?, timeoutMs?,
                  maxRetries?, chunkSize? })

list(path)                       -> Promise<FtpEntry[]>
read(path, onProgress?, signal?) -> Promise<Uint8Array>
write(path, data, signal?)       -> Promise<void>
remove(path, signal?)            -> Promise<void>   // optional signal on impl
dispose()                        -> void            // extra: unsubscribe + drop in-flight
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
`OpenFileRO=4`, `ReadFile=5`, `CreateFile=6`, `WriteFile=7`, `RemoveFile=8`,
`CreateDirectory=9`, `RemoveDirectory=10`, `BurstReadFile=15`, `Ack=128`,
`Nak=129`. A NAK carries its error code in `data[0]`; `EndOfFile=6` is a normal
terminator for read/list, not a failure.

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

`OpenFileRO` (`Ack.session` = the session, `Ack.data` = u32 LE file size) →
prefer `BurstReadFile` pages. A burst request may receive multiple ACK frames
with the same response sequence; the client sorts by payload `offset`, appends
only contiguous data, and re-requests the first missing offset when frames arrive
out of order or with a gap. If burst is unsupported (`UnknownCommand`) or stalls
without progress, the client falls back to sequential `ReadFile` from the current
offset. `TerminateSession` is best-effort in a `finally`.

### `write(path, data, signal?)`

`CreateFile` opens/truncates the path and returns a session. The client sends
`WriteFile` chunks of up to `FTP_MAX_DATA` bytes with the correct byte offset
until all data is acknowledged, then best-effort `TerminateSession`s. Any NAK
rejects with `FtpError('nak')` and the server error code.

### `remove(path, signal?)`

One `RemoveFile` transaction carrying `utf8(path)`. ACK resolves; NAK rejects.

`FtpError` carries `{ reason: 'timeout' | 'aborted' | 'nak' | 'send-failed' |
'protocol', nak? }`.

## Owned files

- `ftp-protocol.ts` — wire constants, opcodes/NAK codes, payload encode/decode.
- `ftp-client.ts` — the client, injected seams, transaction machines, `FtpError`.
- `index.ts` — public exports.

## Testing

`test/unit/ftp.test.ts` (mock host + fake clock): payload codec round-trip;
sequential fallback read; robust burst assembly/re-request; progress vs file
size; short/empty final chunk EOF; non-EOF NAK rejects; directory listing with
paging + skips; timeout→retry→resolve and timeout→reject; seq +
system/component correlation; abort cancels; multi-chunk write with termination;
remove ACK/NAK handling.
