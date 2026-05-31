# `transport/serial` — Web Serial transport (T1.6)

A pluggable **Web Serial** `Transport` + `TransportFactory` (id `"serial"`) — the
primary path for USB autopilots and telemetry radios (SiK, RFD900, …) in a
`file://` secure context (spec `plan/03` §3.5 item 1). Implements the **frozen**
`src/contracts/transport.ts` seam exactly; it does not modify any contract.

## Contract

```ts
serialTransportFactory: TransportFactory          // probes navigator.serial
createSerialTransportFactory(deps?): TransportFactory
new SerialTransport(deps?): Transport
```

`Transport` surface (from the frozen contract):

| Member         | Behavior                                                                            |
| -------------- | ----------------------------------------------------------------------------------- |
| `id`           | `"serial"`.                                                                         |
| `capabilities` | `{ duplex: true, reconnect: false }` (see _Reconnect_ below).                       |
| `open(config)` | `{ baudRate?: number }`; defaults to **115200**, accepts any +int.                  |
| `close()`      | Aborts the byte pumps, releases the port, emits `closed`.                           |
| `readable`     | Inbound `ReadableStream<Uint8Array>` (stable; bytes counted here).                  |
| `writable`     | Outbound `WritableStream<Uint8Array>` (stable; bytes counted here).                 |
| `onState(cb)`  | Emits `ConnState`; **current state delivered immediately**; returns an unsubscribe. |
| `stats()`      | `LinkStats` (see _Stats_).                                                          |

`TransportFactory`: `id`, `label`, `isSupported()` (= `'serial' in navigator`),
`configSchema` (a baud-rate `select` descriptor for the connection UI, T1.10),
and `create()`.

## Design

- `readable`/`writable` are stable `TransformStream` endpoints created in the
  constructor — the contract types them as non-null readonly streams. `open`
  pipes the port's streams through these transforms, which is where byte counters
  increment as data flows. Framing belongs to the codec (T1.1), so the transport
  never parses MAVLink.
- `open` acquires the port through an injectable hook (default
  `provider.requestPort()`), opens it at the requested baud, and starts two
  `pipeTo` loops (port→`readable`, `writable`→port) with `AbortController`s that
  `close` aborts cleanly. Intentional-abort rejections are swallowed; any other
  pipe failure surfaces as `{ kind: 'error' }`.

### Stats

Bytes update live as data flows. `packetsIn`, `lossPct`, and `rateHz` stay `0`
(framing/rate is the codec's job, not the byte transport), `signed` is `false`,
and `rssi` is omitted (it comes from `RADIO_STATUS` in the connection manager).

### Reconnect

A `disconnect` (re-plug/unplug) event transitions to `{ kind: 'error' }` and
tears the link down. **Automatic re-open is intentionally not implemented here**:
the frozen `Transport` seam exposes `readable`/`writable` as stable readonly
streams that cannot be re-wired after a real `SerialPort` is lost, so retry/relink
policy is owned by the connection manager (T1.10). `capabilities.reconnect` is
therefore `false`; the `ConnState` machine still models `reconnecting` for that
manager to use.

## Testability

All ambient access is injectable so unit tests never touch real globals or prompt
a chooser:

```ts
new SerialTransport({ provider, requestPort }); // fake navigator.serial / port
createSerialTransportFactory({ provider, requestPort, isSupported });
```

- `provider` — a fake `navigator.serial` (`SerialProviderLike`).
- `requestPort(provider)` — overrides port acquisition (default
  `provider.requestPort()`); tests return a fake `SerialPort`.
- `isSupported` — overrides capability detection (defaults to `'serial' in
navigator`, or `true` when a `provider` is injected).

## Owned files

- `types.ts` — structural Web Serial types, config type, baud constants.
- `config-schema.ts` — connection-UI `configSchema` descriptor.
- `serial-transport.ts` — `SerialTransport` (the `Transport` impl).
- `factory.ts` — `createSerialTransportFactory` / `serialTransportFactory`.
- `index.ts` — public barrel.

## How to test

```sh
npx vitest run test/unit/transport-serial.test.ts
```

Covers open/close lifecycle + state transitions, default/custom/invalid baud,
inbound bytes flowing into `readable`, outbound writes reaching the fake port,
`stats` counters, `isSupported` true/false (injected vs absent serial), disconnect
→ error, and the factory surface.

## Scope note

This task ships only the Serial transport + factory. Wiring it into the
multi-link connection manager and drawer UI (transport picker, live link stats)
is T1.10; the GCS heartbeat / stream-rate management is T1.9/T1.11.
