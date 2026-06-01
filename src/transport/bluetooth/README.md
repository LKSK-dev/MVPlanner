# `transport/bluetooth` — Web Bluetooth GATT transport

Implements task T8.3: a `Transport`/`TransportFactory` with id `bluetooth` for
serial-over-BLE telemetry bridges.

## Design

`BluetoothTransport.open(config)`:

1. validates `{ serviceUuid, rxCharUuid, txCharUuid, deviceFilters?, mtu? }`
2. calls `bluetooth.requestDevice()` using the provided filters, or
   `acceptAllDevices: true` with the configured service as an optional service
3. connects `device.gatt`
4. resolves the service and RX/TX characteristics
5. starts notifications on RX and enqueues each `DataView` notification as bytes
6. writes outbound bytes to TX using `writeValueWithoutResponse`, falling back to
   `writeValueWithResponse`/legacy `writeValue`

Web Bluetooth does not expose the negotiated ATT MTU, so outbound chunking uses a
conservative 20-byte default (`DEFAULT_BLE_MTU`). Apps/tests may pass `mtu` when
the bridge exposes or documents a larger negotiated payload.

## Testability

The transport accepts an injected `bluetooth` provider and `requestDevice` hook.
Fakes only need to implement the structural `*Like` types in `types.ts`; RX tests
set a characteristic `value: DataView` and dispatch `characteristicvaluechanged`.

## Validation

```sh
npx vitest run test/unit/transport-bluetooth*.test.ts
npx eslint src/transport/bluetooth test/unit/transport-bluetooth*.test.ts
```
