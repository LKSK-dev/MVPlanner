# Replay transport (T1.8)

Spec: `plan/03` §3.5 item 6, `plan/07` §7.4.

Feeds a recorded **tlog** back through the same byte pipeline a live link uses, so
playback exercises the identical MAVLink stack (HUD/map/instruments behave exactly
as live). Implements the frozen `Transport` / `TransportFactory` contract in
`src/contracts/transport.ts` **exactly**; the playback control methods are
_additive_ members on the concrete `ReplayTransport` class and do **not** change
the contract.

## Owned files

- `tlog-parser.ts` — splits a tlog byte stream into timestamped frames.
- `scheduler.ts` — injectable `setTimeout`-like timer source.
- `replay-transport.ts` — `ReplayTransport` (`Transport` + playback controls).
- `factory.ts` — `replayTransportFactory` (`TransportFactory`, id `'replay'`).
- `index.ts` — public barrel.

## tlog format

Each entry is `[u64 big-endian timestamp in 100 ns ticks] + raw MAVLink frame`,
appended in receive order (Mission Planner / pymavlink compatible). Frame
boundaries are found from the MAVLink magic + length byte:

| Version   | Magic                   | Total bytes                                     |
| --------- | ----------------------- | ----------------------------------------------- |
| v1        | `0xFE`                  | `payloadLen + 8` (6 header + payload + 2 CRC)   |
| v2        | `0xFD`                  | `payloadLen + 12` (10 header + payload + 2 CRC) |
| v2 signed | `0xFD`, INCOMPAT `0x01` | `payloadLen + 12 + 13` (signature block)        |

> The §7.4 task note "`8 + payloadLen + 2`" / "`12 + payloadLen + 2`" is the same
> figure: the `8`/`12` overhead constants already include the 2-byte CRC, which is
> the "+2". The numbers above are the canonical MAVLink frame sizes, required so
> real recorded tlogs (and the record→replay equivalence test in M2) parse.

A truncated trailing entry (recording cut mid-frame) is tolerated: parsing stops
and returns the frames decoded so far. An unknown magic mid-stream throws
`TlogParseError`.

## API

```ts
const t = replayTransportFactory.create() as ReplayTransport;
await t.open({ data: tlogBytes, speed: 1 }); // emits opening -> open
// t.readable: ReadableStream<Uint8Array> — each frame's raw bytes, scheduled by
//   the delta between consecutive tlog timestamps / speed.
// t.writable: WritableStream<Uint8Array> — no-op sink (replay is one-way).
t.setSpeed(4); // 0.1x–32x; scales inter-frame delays
t.pause(); // stop the clock; pending frame stays queued
t.resume(); // continue
t.seek(timeUs); // jump to first frame at/after timeUs (relative µs); emits it now
t.step(); // emit exactly one frame immediately, then pause
t.stats(); // { bytesIn, packetsIn, ... } counted from emitted frames
await t.close(); // emits closed
// end-of-stream emits 'closed' and closes the readable automatically.
```

`timeUs` passed to `seek` is **relative microseconds from the first frame**
(the first frame is time 0).

## Timing & determinism

All timing flows through the injectable `Scheduler` (`scheduler.ts`). Tests pass a
manual scheduler (assert exact per-gap delays) or use `vi.useFakeTimers()` with the
default scheduler. `setSpeed` while a gap is already counting down restarts that
gap's wait with the new speed.

## Test

```
npx vitest run test/unit/transport-replay.test.ts
```
