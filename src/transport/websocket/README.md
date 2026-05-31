# `transport/websocket` — WebSocket bridge transport (T1.7)

Connects the browser to a `ws://` / `wss://` endpoint that proxies a MAVLink
TCP/UDP stream — SITL (`tcp:5760`), `mavlink-router`, `mavproxy`, or the optional
companion bridge (spec `plan/03` §3.5 item 4 + §3.6). This is the path
Firefox/Safari and network/remote links use when Web Serial/BLE/USB aren't
available.

## Contract

Implements the frozen `Transport`/`TransportFactory` seam
(`src/contracts/transport.ts`) **exactly** — no additions:

```ts
const factory = createWebSocketTransportFactory(); // id 'websocket'
const transport = factory.create();
await transport.open({ url: 'ws://localhost:5760' }); // resolves on first connect
transport.readable; // ReadableStream<Uint8Array> of inbound MAVLink bytes
transport.writable; // WritableStream<Uint8Array> -> ws.send
transport.onState((s) => …); // ConnState: opening → open → reconnecting → closed
transport.stats(); // LinkStats byte/packet counters
await transport.close(); // cancels backoff, sets 'closed'
```

- `open(config)` validates `{ url }` (must start with `ws://`/`wss://`) and
  resolves once the socket opens; if the **initial** connect closes before
  opening it rejects (no auto-reconnect for a never-connected link).
- Inbound binary frames (socket `binaryType = 'arraybuffer'`) are enqueued onto
  `readable` as `Uint8Array`; text/control frames are ignored.
- `writable` writes call `socket.send(bytes)`; a write while not connected
  throws (the connection manager owns higher-level retry/queueing).
- `capabilities = { duplex: true, reconnect: true }`.
- `stats()` reports `bytesIn`/`bytesOut`/`packetsIn`; `lossPct` is `0` and
  `signed` is `false` (a raw byte pipe can't know either — loss/signing accrue in
  the codec/registry), and `rateHz` is `0` here.

### Reconnect & backoff

An **unexpected** close (after the link was open, or a failed reconnect attempt)
emits `{ kind: 'reconnecting', attempt }` and schedules a reconnect with
**exponential backoff** `min(base · 2^(attempt-1), max)` (defaults 500 ms →
16 000 ms ceiling). A successful reconnect resets the attempt counter.
`close()` cancels any pending backoff and is idempotent into `closed`.

## Testability

`WebSocketTransport` / `createWebSocketTransportFactory` accept
`WebSocketTransportOptions`:

- `WebSocketCtor` — injected `WebSocket` constructor (defaults to the global).
- `scheduler` — single-shot backoff scheduler (defaults to `setTimeout`-based).
- `backoffBaseMs` / `backoffMaxMs` — backoff tuning.

This keeps the module DOM-free and lets unit tests drive a fake socket
(`onopen` / `onmessage(ArrayBuffer)` / `onclose`) and a manual clock with no real
network. `isSupported()` is `true` when a constructor is injected, otherwise
`typeof WebSocket !== 'undefined'`.

## Owned files

- `websocket-transport.ts` — `WebSocketTransport`, factory, config schema, types.
- `index.ts` — public barrel.

## How to test

```sh
npx vitest run test/unit/transport-websocket.test.ts
```

Covers: config validation; `open` → `onopen` ⇒ `open`; inbound `ArrayBuffer`
bytes on `readable`; writes hitting `socket.send`; byte/packet `stats`;
unexpected close ⇒ `reconnecting` + bounded exponential backoff ⇒ reconnect;
`close()` cancels backoff ⇒ `closed`; initial-connect failure rejects `open`;
and `isSupported()` via an injected constructor.

## Scope note

This task ships only the transport. Wiring it into the connection manager and
drawer UI (factory registration, config form, live stats) is **T1.10**; the
companion bridge artifact itself is **T1.13**. Neither is owned here.
