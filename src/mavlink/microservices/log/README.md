# MAVLink log microservice

Task T6.1 implements the frozen `LogClient` contract over the MAVLink `LOG_*`
DataFlash protocol:

- `list(signal?)` sends `LOG_REQUEST_LIST` for `start=0,end=0xffff`, collects
  `LOG_ENTRY` frames, and re-requests missing id ranges after a quiet window.
- `download(id,onProgress?,signal?)` preallocates the advertised log size,
  accepts out-of-order `LOG_DATA` chunks, tracks merged byte ranges, re-requests
  missing gaps with `LOG_REQUEST_DATA(ofs,count)`, sends `LOG_REQUEST_END` when
  complete/aborted/timed out, and returns a `Blob` of the assembled bytes.
- `erase()` sends `LOG_ERASE` to the current target. The LOG protocol has no ACK.

The host seam is deliberately small for tests and worker integration:
`{ sendMessage, onMessage, getTarget, clock, ftp? }`. `sendMessage` and
`onMessage` bind to `src/mavlink/host`; `getTarget` resolves the active vehicle
`sysid/compid`; `clock` lets unit tests advance retries deterministically. The
optional `ftp` dependency is accepted for firmware-specific file-log paths, but
classic `LOG_*` remains the primary path exposed by the frozen `LogClient` API.

Retry strategy: every accepted frame pushes out a quiet-window timer. When the
window fires, listings request only missing id ranges, downloads request only
missing byte gaps, and consecutive no-progress windows are bounded by
`maxStallRounds` before rejecting with `LogError(reason='timeout')`.
