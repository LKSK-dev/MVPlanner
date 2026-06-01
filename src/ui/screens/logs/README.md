# `ui/screens/logs` — Logs & analysis screen (T6.5 + T6.8)

Spec: `plan/04` §4.7 (tlog playback) / §4.8 (DataFlash analysis) / §4.9
(inspector + sender); `plan/05` §5.4 (Logs). The M6 keystone — composes the
committed log widgets into the Logs screen and owns the **flight-track core**
(T6.5).

## Composition (`logs-screen.tsx`)

- **Source picker** — "Open DataFlash log…" decodes a `.bin`/`.log` into a
  {@link LogQueryIndex}; "Open telemetry log…" feeds the tlog playback path; an
  "Export CSV" button saves the plotted series.
- **Plotter** (dominant) — fed `LogQueryIndex.querySeries` /
  `evaluateDerived` points; `cursorUs` ⇄ map sync via `onCursor`.
- **Series picker** (`series-picker.tsx`) — a searchable `message.field` tree,
  a derived-expression input, and the selected-series list.
- **Map track** (`track/**`, T6.5) — the GPS/POS flight track + a cursor-synced
  marker. The cursor⇄position mapping is pure and unit-tested.
- **Inspector** + **MessageSender** — the live MAVLink power tools (sender bound
  to the host send seam).
- **PlaybackControls** — tlog scrub/speed + the preset-analysis selector
  (selecting a preset adds its series to the plot).

## Decode path

`source.ts` provides two decoders; the screen's `decodeBin` seam defaults to the
**worker** path:

- `decodeDataFlashInWorker` — PREFERRED. Lazily (`import(...?worker&inline)`)
  spins the inlined log worker and streams decoded records over RPC so a large
  file decodes OFF the main thread. The dynamic import keeps the worker bundle
  out of the module graph until a `.bin` is opened (screen unit tests never spawn
  a Worker). The `dataflash.decode` RPC method string is re-declared locally so
  this main-thread module never value-imports the worker entry (which would run
  its `serveWorker(self)` side effect on the main thread); types come in via
  `import type`.
- `decodeDataFlashOnMainThread` — a fallback over the pure decoder that also
  captures UNIT/MULT metadata (so series carry unit labels). Used by tests.

## Cursor ⇄ track-position sync (T6.5, `track/track.ts`)

`findTrackSource` → `buildTrackFromSeries` builds an ordered polyline from the
GPS/POS lat+lon columns (same message ⇒ same timestamps). `interpolateTrackAt`
linearly interpolates the track at the plot cursor `timeUs` (cursor→map);
`nearestTrackTime` maps a map click back to the nearest track `timeUs`
(map→cursor). `createTrackCursorLayer` draws the synced marker. Geometry is pure

- unit-tested; the `<canvas>` stroke is canvas-deferred.

## Wiring

`App` installs the panel via `setScreenPanel('logs', createLogsScreenPanel(...))`
with `storage.files`, `storage.blobs`, the host `sendMessage` send seam and the
host inspector stream (when connected).

## Pure-tested vs deferred

- **Pure / component** (`test/unit/logs-screen.test.ts`) — the track core,
  decode→index, the composed render, add-series→plot, CSV export, and the shell
  mount.
- **Deferred (M6 gate / browser)** — large-`.bin` decode perf, canvas plot/map
  pixels, and host-driven tlog replay (the playback transport advancing the live
  HUD/map/instruments is the connection-manager's concern).
