# `data/tlog` — telemetry-log (tlog) recording

Records every received MAVLink frame to a **Mission-Planner-compatible tlog**.
Task **T2.10** (spec `plan/07` §7.4; never-drop path `plan/02` §2.6). Built on the
storage foundation (`data/storage` `BlobStore` + `FileIo`, T0.9) and consuming
the MAVLink host's never-dropped raw-frame tap (`MavlinkHost.onRawFrame`, T1.9).
The byte format is the exact inverse of `transport/replay`'s `parseTlog` (T1.8),
so a recording round-trips cleanly back through the replay stack.

## tlog byte layout

A tlog is a flat byte stream of consecutive entries appended in **receive order**:

```
[ u64 BIG-ENDIAN timestamp, 100 ns ticks ][ raw MAVLink frame bytes ] ...repeat
```

- The timestamp is derived from a frame's receive time in **microseconds**:
  `ticks = microseconds × 10` (MP / pymavlink convention).
- The raw frame bytes are written verbatim (v1 `0xFE` / v2 `0xFD`, including any
  v2 signature block) — no re-encoding. Frame length is recoverable from the
  MAVLink magic + length byte, which is exactly how `parseTlog` re-splits entries.

Encoding is pure and isolated in `encoder.ts` (`encodeTlogEntry`,
`microsToTlogTicks`) so the wire format is the single source of truth and is
unit-tested directly against `parseTlog`.

## API

```ts
const rec = new TlogRecorder({
  source,          // RawFrameSource — MavlinkHost satisfies this structurally
  blobs,           // BlobStore (data/storage)
  fileIo?,         // FileIo for saveAs()
  namespace?,      // blob namespace (default "tlog")
  chunkBytes?,     // flush threshold (default 64 KiB)
  autoStartOnConnect?,
  now?, idFactory?,
});

const id = await rec.start(sidecar?); // begin; optional sidecar metadata record
rec.isRecording;                      // boolean
rec.currentId;                        // active/last recording id
rec.stats();                          // { recording, recordingId?, frameCount, sizeBytes, durationUs }
await rec.stop();                     // flush + settle; re-throws first flush error
const blob = await rec.export();      // full tlog as one Blob
await rec.saveAs(name?);              // write the tlog to disk via FileIo
await rec.dispose();                  // unsubscribe taps + final flush
```

`TlogRecorder` taps `source.onRawFrame` **on construction** but only writes
between `start()` and `stop()`. `autoStartOnConnect` additionally taps
`source.onState`: `open` → `start()`, `closed`/`error` → `stop()`.

### Never-drop guarantee

The recording path is **synchronous at the point of receipt**. The host delivers
raw frames on a path it keeps **separate from coalesced telemetry**; the
recorder's tap callback encodes the entry and appends it to an in-memory buffer
**without awaiting anything**, so it can neither apply back-pressure to the wire
nor be skipped under UI load. Persistence happens off that hot path: once the
buffer reaches `chunkBytes` it is handed to a **serialized flush chain** (chunks
land in receive order) while new frames keep appending to a fresh buffer. A
stalled `BlobStore` grows the pending buffer rather than dropping data; the first
flush error is captured and re-thrown by `stop()`/`export()` (never swallowed).

### Storage layout

Within `namespace` (default `"tlog"`):

- `"<id>/<n>"` — chunk records, written in receive order (M2 default = chunked
  IndexedDB).
- `"<id>/sidecar"` — optional JSON sidecar metadata (`vehicleType`,
  `startedAtMs`, …), persisted as a **separate** record.

`export()` reassembles every chunk (in order) plus any un-flushed tail into the
full tlog blob; `saveAs()` writes that blob to disk.

> **Enhancement (deferred):** streaming directly to disk via `FileIo` to avoid
> any IndexedDB round-trip is documented in `plan/07` §7.4 but **not** the M2
> default. M2 ships the chunked-IndexedDB path; `saveAs()` exports the assembled
> blob. True per-chunk disk streaming can be added behind the same API later.

## Owned files

- `encoder.ts` — pure tlog entry encoding + tick conversion + concat helper.
- `recorder.ts` — `TlogRecorder` (subscription, never-drop buffer, chunked
  flush, export, saveAs, sidecar).
- `types.ts` — `RawFrameLike` / `RawFrameSource` structural seams, options,
  `TlogSidecar`, `TlogStats`.
- `index.ts` — public barrel.

## How to test

```sh
export npm_config_cache="$PWD/.npm-cache"
npx vitest run test/unit/tlog-recorder.test.ts
```

The test imports `fake-indexeddb/auto` to provide IndexedDB and covers the wire
format (u64 BE 100 ns ticks), append order, start/stop + `frameCount`/`size`/
`duration`, chunked persistence into a real `BlobStore`, `export()`, sidecar
records, auto-start-on-connect, and the **record → export → `parseTlog`
round-trip** (recovered frames + relative timestamps equal the input).
