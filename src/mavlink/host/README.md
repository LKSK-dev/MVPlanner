# `mavlink/host` — MAVLink worker host (T1.9)

Spec: `plan/02` §2.1 (data flow) / §2.6 (threading & coalescing). This is the
M1 integration hub that wires the codec, registry, and vehicle model into a live
connection and pushes coalesced telemetry to the UI.

## Threading model

Heavy parsing runs **off** the main thread:

- **Main thread** (`host.ts` → `MavlinkHost`) owns the `Transport` (Web Serial /
  WebSocket / replay are main-thread APIs). It is a **thin byte relay**:
  - inbound: `transport.readable` → RPC `ingestBytes` (worker parses)
  - outbound: worker `outgoing` stream → `transport.writable`
    No MAVLink parsing happens on the main thread.
- **Worker** (`src/workers/mavlink.worker.ts`) is a thin RPC shim around one
  `MavlinkSession`. It runs the codec parser + `MessageRegistry` + `VehicleModel`
  and emits **coalesced** snapshots (~25 Hz, only on change) plus a 1 Hz GCS
  heartbeat on the outgoing stream.

```
Transport ── readable ──▶ MavlinkHost ──ingestBytes──▶ Worker ─▶ MavlinkSession
   ▲                          │  ◀──telemetry (coalesced)──┘
   └── writable ◀──outgoing── MavlinkHost ◀──outgoing (heartbeat + sends)──┘
```

## Owned files

- `session.ts` — `MavlinkSession`: the **pure, DOM/Worker-free** core. Parse →
  registry + vehicle model → coalesced `TelemetrySnapshot`; outgoing-frame
  encoding (`encodeHeartbeat`, `encodeMessage`) on a single tx sequence;
  `setSigning`. Injectable dialects / signing / clock. Unit-testable directly.
- `protocol.ts` — the RPC method names + request/response types shared by the
  worker and the host (single source of truth for the wire contract).
- `host.ts` — `MavlinkHost`: main-thread client. Instantiates the worker
  **inlined** (`?worker&inline`) for the single-file build, owns the transport,
  runs the byte relays, overlays `transport.stats()` byte/rssi/signed counters
  onto each vehicle's `LinkStats`, and fans out telemetry / connection state.
- `index.ts` — public surface.
- `../../workers/mavlink.worker.ts` — the thin worker entry (also owned by T1.9).

## Snapshot shape

`TelemetrySnapshot` = `{ vehicles, rates, activeSysid?, rev }`:

- `vehicles[].link` is filled from the registry's rate/loss accounting
  (`packetsIn`, `lossPct`, `rateHz`); `bytesIn/out`, `rssi`, `signed` are left at
  defaults for the host to overlay from `transport.stats()`.
- `rates` is the light inspector rate/last-seen/count table (ring-free, no
  fields/raw — cheap enough for the always-on ~25 Hz telemetry stream).
- `activeSysid` is the most-recently-heard vehicle.
- `rev` is a monotonic revision used to coalesce/skip unchanged emits.

## Inspector stream (on-demand, T1.12)

The MAVLink inspector (spec `plan/04` §4.9) needs the **full** per-stream table,
including the latest decoded fields and the latest raw frame bytes (for the hex
view) — too heavy for the always-on telemetry path. So it is a SEPARATE,
on-demand RPC stream:

- `protocol.ts` adds `RPC_INSPECTOR = 'inspector'` + `InspectorRequest { hz? }`.
- `session.ts` adds `takeInspectorSnapshot(): InspectorSnapshot` where
  `InspectorSnapshot = { rows: InspectorRow[], rev }` and each `InspectorRow`
  carries `{ sysid, compid, msgId, name, rateHz, lastSeenMs, count, fields, raw,
crcOk, signed, linkId?, seq, rxTimeUs }`, sourced from the `MessageRegistry`
  snapshot (`latest` + rate/last-seen/count).
- The worker (`mavlink.worker.ts`) registers `handleStream(RPC_INSPECTOR, ...)`
  which builds + emits `takeInspectorSnapshot()` at ~6 Hz (default) and ONLY
  while subscribed; cancelling the stream tears the interval down.
- `host.ts` adds `subscribeInspector(cb, { hz? }): () => void` — opens the
  stream, returns a disposer that aborts it. Independent of `connect()`.

Enum decoding of field values is the UI's job (the inspector widget reads dialect
metadata); the wire payload stays raw to keep it light.

## How to test

- `test/unit/mavlink-session.test.ts` drives the **pure** `MavlinkSession`
  end-to-end with real encoded frames (HEARTBEAT + GLOBAL_POSITION_INT +
  GPS_RAW_INT): vehicle class/mode/armed/position/GPS derivation, link-stat
  overlay, coalescing, and outgoing HEARTBEAT / `encodeMessage` round-trips.
- The worker entry + `MavlinkHost` Worker/transport plumbing is **deferred to
  SITL / e2e** (T1.10): vitest + happy-dom Worker and Web Streams support is too
  limited to exercise the inlined-worker relay meaningfully.

## Residual notes

- **Transferables.** The frozen `src/core/bus` RPC does not expose a
  `postMessage` transfer list, so inbound chunks and outbound frames cross the
  worker boundary by **structured clone (copy)**, not zero-copy transfer. This is
  correct and safe (the transport yields fresh chunks); a zero-copy fast path
  would require a bus enhancement (contract change — escalate) and is not needed
  to meet the M1 live-path budget.
- **Auto-reconnect** is the transport's / connection-manager's concern (T1.10);
  the host does not retry.
