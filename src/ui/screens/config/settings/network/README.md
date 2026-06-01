# Settings → Network — egress transparency (T8.12)

Spec: plan/07 §7.7, plan/08 §8.3.

A read-only section (rendered inside the Settings screen) that lists **every**
network destination the app can reach — there is no analytics and nothing phones
home (stated prominently).

## Pieces

- **`egress-log.ts`** — `createEgressLog()`: a small, bounded, DOM-free ring with
  `record` / `list` (newest-first) / `clear` / `subscribe`. It is the sink the
  `PermissionBroker.recordEgress` writes to (extension `net:<host>` calls). `App`
  creates one and passes `recordEgress: (info) => egressLog.record(info)` to
  `createExtensionSystem`.
- **`network-section.tsx`** — `NetworkSection`: the reactive UI. All data sources
  are injected (`NetworkSectionDeps`):
  - `egress` — the live egress log (required),
  - `links?` — accessor of active ws/wss/WebRTC destinations,
  - `netGrants?` — async loader of extension `net:<host>` grants.
  - map-tile host is derived reactively from `store.settings.mapSource`.

## Wiring

`App.buildNetworkDeps(...)` composes the deps and threads them to the Config
screen → Settings panel (`network` prop, additive + optional). Omit `network` and
the section is not rendered (existing Settings tests are unaffected).

## Testing

`test/unit/egress-network.test.ts` covers the log semantics + the rendered
section (lists destinations, clears the log).
