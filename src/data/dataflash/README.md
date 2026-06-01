# DataFlash streaming decoder

Task T6.2 implements a pure ArduPilot DataFlash (`.bin` / `.log`) decoder.

- Feed bytes incrementally with `DataFlashDecoder.feed(chunk)`; decoded records
  are returned and optionally delivered through `onRecord`.
- `FMT` packets (`type=128`) build the message registry used for later records.
- Helpers:
  - `decodeDataFlash(source)` async-iterates all decoded records.
  - `enumerateDataFlashTypes(source)` scans lazily and returns the type/field index.
  - `iterateDataFlashRecords(source, typeOrName)` streams only one message type.
- `source` can be an iterable/async iterable of `Uint8Array` chunks or a `Blob`;
  Blob inputs are sliced into bounded chunks.

Supported ArduPilot format chars: `a b B h H i I f d n N Z c C e E L M q Q`.
`q`/`Q` decode to `bigint`; `a` decodes to `number[32]`. `UNIT`, `MULT`, and
`FMTU` metadata is captured best-effort when those message types are present.

The worker entry in `src/workers/log.worker.ts` exposes this decoder over the
existing worker RPC. Main-thread client/query plumbing is intentionally deferred
to T6.3/T6.8.
