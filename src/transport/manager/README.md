# transport/manager — Connection manager (T1.10)

Spec: `plan/03` §3.5 ("Connection manager") / §3.7; `plan/04` §4.1; `plan/05` §5.2.

## Contract

`ConnectionManager` owns one `MavlinkHost` (the main-thread MAVLink worker
client) and turns its two raw event streams into a small, UI-friendly surface:

```ts
const manager = createConnectionManager({ host });

await manager.connect('serial', { baudRate: 115200 }); // or 'websocket' / 'replay'
await manager.disconnect();

manager.state(); // current ConnState
manager.vehicles(); // all detected vehicles (multi-vehicle aware)
manager.activeSysid(); // resolved active vehicle sysid
manager.setActiveVehicle(2); // explicit selection (falls back to most-recent)
manager.stats(); // merged LinkStats: rate/loss/rssi/signed/bytes

const offState = manager.onState((s) => {
  /* ConnState transition */
});
const offTele = manager.onTelemetry((t) => {
  /* vehicles + activeSysid + stats */
});

await manager.dispose(); // drops subscriptions + disposes host (terminates worker)
```

- **Multi-vehicle aware, single active link (M1).** Telemetry carries every
  vehicle the worker registry routed by `sysid`; the manager tracks the ACTIVE
  vehicle — the user's explicit `setActiveVehicle` selection when it still
  matches a known vehicle, otherwise the most-recently-heard vehicle from the
  snapshot.
- **State mapping.** Host `onState` → `ConnState`; on `closed` the manager
  clears detected vehicles so the UI shows no stale rows. A failed `connect`
  surfaces an `error` state and re-throws.
- **Diagnostics.** `stats()` is the host's merged `LinkStats`
  (transport bytes/rssi + registry rate/loss/packets/signed).

## Owned files

- `connection-manager.ts` — the manager + `createConnectionManager`, plus the
  structural `MavlinkHostLike` / `HostTelemetry` interfaces it depends on.
- `index.ts` — public barrel.

## Why a structural host interface

The manager depends only on `MavlinkHostLike` (a structural subset of
`MavlinkHost`), so importing it never pulls the `?worker&inline` MAVLink worker
into the graph. Unit tests inject a lightweight mock host — no real Worker is
spun. The real `MavlinkHost` is assignable to `MavlinkHostLike` and is wired in
`src/App.tsx` via the connection provider (`src/ui/shell/connection`).

## How to test

`test/unit/transport-connection-manager.test.ts` drives the manager with a mock
host: it asserts `connect`/`disconnect` delegate with the right factory id +
config, `onState` mapping, vehicle detection from telemetry, active-vehicle
selection + most-recent fallback, stale-vehicle clearing on `closed`, and that
`dispose` releases the host. The real-Worker / SITL connect path is exercised at
the M1 gate (`plan/10`), not in unit tests.
