# `ext/permissions` — permission model + broker (T7.2)

The mediation layer between an extension and every privileged capability. Spec:
`plan/06` §6.5 (permission model) / §6.6 (sandbox & isolation); `plan/08` §8.3
(security: destructive-action gating + audit, egress transparency). Contracts:
`src/contracts/ext-api.ts` (`Permission`), `src/contracts/ui.ts`
(`ConfirmOptions`), `src/contracts/storage.ts` (`KvStore`), `src/core/audit`
(`AuditLog`).

It is **not** the sandbox runtime (that's `ext/sandbox`, same task) and **not**
the concrete `ExtContext` (that's **T7.3**): this module is the policy + broker
that T7.3 registers concrete methods against.

## Three pieces

| Piece              | Surface                                           | Role                                                                                                                                                              |
| ------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Grant store**    | `createGrantStore(kv) → GrantStore`               | per-extension granted `Permission[]`, persisted via `KvStore`; `grant`/`revoke`/`set`/`list`/`isGranted`/`clear` (in-session cache, reads back across instances). |
| **Install prompt** | `requestGrants(manifest, { prompt, grants })`     | annotates requested scopes (high-risk flagged), calls the injected `prompt(manifest, requests)`, clamps the result to _requested_ scopes, persists it.            |
| **Broker**         | `createPermissionBroker(deps) → PermissionBroker` | `registerApi` + `invoke` mediation + `capabilitiesFor`.                                                                                                           |

## Broker

```ts
const broker = createPermissionBroker({ grants, confirm, audit, recordEgress? });

const off = broker.registerApi(method, required, handler, opts?);
//   method:   dotted ctx method name, e.g. "command.arm", "params.set", "net.fetch"
//   required: Permission | null   (null = always available; net uses opts.net)
//   handler:  (extId, args, signal?) => Promise<unknown>
//   opts:     { net?, auditKind?, summary? }

await broker.invoke(extId, method, args, signal?);  // the single mediation point
await broker.capabilitiesFor(extId): Set<string>;   // granted-only method names
```

`invoke` enforces, in order:

1. **Existence** — unknown method ⇒ `ExtPermissionError('unknown-method')`.
2. **Permission** — `required` must be granted ⇒ else `ExtPermissionError('not-granted')`.
   Combined with `capabilitiesFor`, an ungranted method is **absent** from the
   guest proxy (spec §6.5 "not just a no-op"); `invoke` re-checks as
   defence-in-depth.
3. **Egress** (`opts.net`) — the per-call host (`args[0]` URL) is gated against the
   granted `net:<host>` scopes (`net:*` wildcard, host or hostname match) and the
   egress is sent to `recordEgress`; blocked ⇒ `ExtPermissionError('egress-blocked')`.
4. **Destructive-action gating** — vehicle-affecting calls (`command`,
   `params:write`, `mission:write`, `mavlink:send`) route through the armed-aware
   `confirm({ destructive: true, armedAware: true })` and write an `AuditLog`
   entry with `origin = extId`: appended `pending`, then `ok`/`error`, or
   `cancelled` + `ExtPermissionError('declined')` when the operator declines.
5. **Error isolation** — a throwing handler rejects the `invoke` promise (and
   records an `error` audit entry); it never crashes the broker/host.

### Risk classification (`risk.ts`)

- `HIGH_RISK_PERMISSIONS` — emphasised in the install prompt: `command`,
  `params:write`, `mission:write`, `mavlink:send`, `transport`, `dialect`.
- `VEHICLE_AFFECTING_PERMISSIONS` — the confirm-gated + audited subset:
  `command`, `params:write`, `mission:write`, `mavlink:send`. (`transport`/`dialect`
  are high-risk to _grant_ but not per-action vehicle commands.)
- `auditKindForPermission` maps a scope to the frozen `AuditKind`
  (`params:write→param-set`, `mission:write→mission-write`,
  `command`/`mavlink:send→command`).

## Capability map for T7.3

T7.3 builds the concrete `ExtContext` by registering each privileged method on
the broker with its required permission, then exposing only `capabilitiesFor`
results in the guest. Suggested registrations (method name ⇒ required scope):

| `ctx` method              | `registerApi` method    | `required`            | notes                               |
| ------------------------- | ----------------------- | --------------------- | ----------------------------------- |
| `ctx.mavlink.send`        | `mavlink.send`          | `mavlink:send`        | vehicle-affecting (confirm + audit) |
| `ctx.mavlink.loadDialect` | `mavlink.loadDialect`   | `dialect`             | high-risk grant                     |
| `ctx.command.*`           | `command.<m>`           | `command`             | vehicle-affecting                   |
| `ctx.params.set`          | `params.set`            | `params:write`        | vehicle-affecting                   |
| `ctx.params.get/getAll`   | `params.get` / `getAll` | `command`†            | read; see note                      |
| `ctx.mission.write`       | `mission.write`         | `mission:write`       | vehicle-affecting                   |
| `ctx.mission.read`        | `mission.read`          | `command`†            | read                                |
| `ctx.ui.*`                | `ui.<m>`                | `ui:panel`            |                                     |
| `ctx.map.*`               | `map.<m>`               | `map`                 |                                     |
| `ctx.theme.register`      | `theme.register`        | `ui:panel`†           |                                     |
| `ctx.files.*`             | `files.<m>`             | `files`               |                                     |
| `ctx.net.fetch`           | `net.fetch`             | `null` + `{net:true}` | per-call host gating                |
| `ctx.transports.register` | `transports.register`   | `transport`           | high-risk grant                     |
| `ctx.notify.*` / `log.*`  | (in-guest, unbrokered)  | —                     | no privilege needed                 |

† Read scopes are a T7.3 product decision (e.g. introduce dedicated read scopes
or gate reads behind the matching write scope) — **flagged for T7.3**, not
decided here. The synchronous, non-privileged surface (`ctx.connection.state`,
`ctx.mavlink.latest`, `ctx.timers`, `ctx.events`, `ctx.log`, `ctx.notify`) lives
in the guest and does not go through the broker.

## Egress recording note

Network calls are gated and handed to the injected `recordEgress` sink. The
frozen `AuditLog` `AuditKind` is vehicle-action only (`command`/`param-set`/
`mission-write`) with **no `net` kind**, so net egress is _not_ written to the
audit log here (it would require a contract change). Wiring `recordEgress` to a
visible egress list (Settings → Network, `plan/07` §7.7) is **T8.12**; a `net`
audit kind, if wanted, is a frozen-contract change needing approval.

## Owned files

`errors.ts` (`ExtPermissionError` + reason) · `risk.ts` (classification) ·
`grant-store.ts` · `prompt.ts` · `broker.ts` · `index.ts` (barrel).

## How to test

```sh
export npm_config_cache="$PWD/.npm-cache"
npx vitest run test/unit/ext-permissions*.test.ts
npx eslint src/ext/permissions test/unit/ext-permissions*.test.ts
```
