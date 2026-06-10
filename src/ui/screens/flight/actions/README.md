# `ui/screens/flight/actions` — actions bar + safety + audit (T2.7)

Spec: `plan/04` §4.2 (Actions quick commands + "confirmations for destructive
actions; disabled when unsafe"), `plan/08` §8.3 (destructive-action gating,
stronger when armed/in-air, audit-logged with origin), §8.8 (exportable audit
log). Builds on the frozen `CommandClient` contract and the `core/audit` service.

Everything is **injected**, so the safety-critical flow unit-tests against mocks
with no real host.

## Pieces

| File              | Role                                                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| `catalog.ts`      | pure `ACTIONS` table: label, destructive flag, `isEnabled`, `run`, `summary` |
| `run.ts`          | `runAction(deps, id, args)` — the confirm→command→audit flow                 |
| `actions-bar.tsx` | `ActionsBar` Solid view (buttons + mode picker + prompts)                    |
| `audit-panel.tsx` | `AuditPanel` Solid viewer (list + JSON/text export + clear)                  |
| `messages.ts`     | `actions.*` + `audit.*` i18n strings                                         |

## Action list (spec §4.2)

`arm`, `disarm`, `takeoff` (alt prompt), `land`, `rtl`, `loiter`, `auto` (start
mission), `pause`/`resume`, `setMode` (vehicle-aware mode list), `setCurrentWp`,
`guidedGoto` (go-here), `guidedChangeAlt`, `changeSpeed`, `setRoi`/`clearRoi`,
`restartMission`, `emergencyStop` (motor kill).

Each maps onto the frozen `CommandClient`: most call a named helper
(`arm`/`setMode`/`takeoff`/…); `pause`/`resume` use `command.send(DO_PAUSE_CONTINUE)`
and `changeSpeed` uses `command.send(DO_CHANGE_SPEED)` (wire ids pinned locally —
the module depends only on the `CommandClient` contract, not on `src/mavlink`).
`emergencyStop` is a force-disarm (`arm(false, true)`); `restartMission` is
`setCurrentWp(0)`.

## Gating (`isEnabled`)

Reactive off the active-vehicle accessor via `gateContextFor(vehicle)`:

- needs a vehicle: `loiter`, `auto`, `setMode`, `setCurrentWp`, `setRoi`,
  `clearRoi`, `restartMission`, `emergencyStop`;
- needs **armed**: `disarm`, `takeoff`, `land`, `rtl`, `pause`, `resume`,
  `guidedGoto`, `guidedChangeAlt`, `changeSpeed`;
- `arm` needs a vehicle that is **not** armed;
- `emergencyStop` is available whenever a vehicle is present — never gated by
  arm/in-air state.

`inAir` = armed AND `position.altRelM > IN_AIR_ALT_M` (1 m).

## Confirmation (`plan/08` §8.3)

Destructive actions (everything except `setRoi`/`clearRoi`) route through
`deps.confirm({ title, body, destructive: true, armedAware })`. `armedAware` is
set when the vehicle is **armed or in-air**, so the shell can present a stronger,
blocking confirmation. A declined confirm sends **no** command and records a
`cancelled` audit entry. Non-destructive actions skip confirm but are still
audited.

## Audit (`core/audit`)

`runAction` appends a `pending` entry (START) with `kind: 'command'`, the
localised `summary`, the `origin` (`'ui'` or an extension id), and a flat
`params` map. On settle it `update`s the entry to `ok` (result `'ok'`) or `error`
(result = the error message). `runAction` never throws for an action failure —
the error is returned in the `ActionOutcome` and recorded.

`AuditPanel` lists entries newest-first and exports via the injected `onExport`
(host wires the download).

## Injection seam (how T2.11 wires it)

```ts
import { ActionsBar, AuditPanel } from './ui/screens/flight/actions';
import './ui/screens/flight/actions/actions.css';

<ActionsBar
  command={commandClient}                 // real CommandClient (T2.5/T2.6)
  confirm={(o) => ui.confirm(o)}           // shell UiRegistry.confirm (T0.7)
  audit={auditLog}                         // shared core/audit instance
  vehicle={() => store.activeVehicle}      // reactive VehicleState accessor
  t={t}
/>
<AuditPanel audit={auditLog} t={t} onExport={(c, fmt) => download(c, fmt)} />
```

The map layer (T2.4/T2.11) calls `runAction(deps, 'guidedGoto'|'setRoi', { lat, lon, altM })`
for its click targets so those go through the same confirm/audit path.

For extensions (T7.2): build `deps` with `origin: extensionId` so vehicle actions
are audited with the extension's identity.

## How to test

- `test/unit/audit-log.test.ts` — the `core/audit` service.
- `test/unit/actions-run.test.ts` — `runAction`: confirm=false aborts (no command,
  cancelled audit), confirm=true → right `CommandClient` call + start/result
  audit, armed-aware confirm flag, gating/blocked, error capture.
- `test/unit/actions-bar.test.ts` — the `ActionsBar`/`AuditPanel` components over
  mocks: gating-driven `disabled`, prompt-driven args, export + clear.
