# `src/contracts` — Frozen module seams

These TypeScript interfaces are the **authoritative boundaries** between modules
(impl plan `02-interface-contracts.md`). They are produced in **M0/T0.3** and
**frozen** so that workers can implement modules **in parallel** (separate
worktrees, disjoint file ownership) against stable types.

## Rules (impl 00 §0.6)

1. **Do not edit a contract unilaterally.** If a task needs a contract change,
   **stop and escalate** to the orchestrator with the proposed diff + rationale.
2. The orchestrator approves, edits here, **bumps `CONTRACTS_VERSION`**, and
   notifies dependent tasks.
3. Depend on contracts, **not** on other modules' internals. Cross-module imports
   go through `@/contracts` (this barrel) or a module's public `index.ts`.
4. The public extension API (`ext-api.ts`) becomes **semver-locked at M7**
   (spec plan/06 §6.10).

## Files

| File               | Seam                                                        |
| ------------------ | ----------------------------------------------------------- |
| `bus.ts`           | Event bus + worker RPC                                      |
| `transport.ts`     | `Transport`, `TransportFactory`, `ConnState`, `LinkStats`   |
| `mavlink.ts`       | Codec, dialect tables, `DecodedMessage`, signing            |
| `microservices.ts` | command / param / mission / ftp / log / calibration clients |
| `vehicle.ts`       | `VehicleState`, `VehicleClass`                              |
| `store.ts`         | `AppState`, `Store`, settings, layout                       |
| `ui.ts`            | `PanelDef`, `CommandDef`, `UiRegistry`                      |
| `map.ts`           | `MapEngine`, `MapLayer`, basemap sources                    |
| `ext-api.ts`       | `ExtManifest`, `Permission`, `ExtContext`                   |
| `storage.ts`       | `KvStore`, `BlobStore`, `FileIo`                            |

`index.ts` re-exports all types and the runtime `CONTRACTS_VERSION`.

## Changelog

| Version | Change                                                                                                                                                                                                                                                                                                                                                     | Approved by  |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1.0.0   | Initial frozen seams (T0.3).                                                                                                                                                                                                                                                                                                                               | orchestrator |
| 1.1.0   | Add `Rpc.handleStream` (server counterpart to `Rpc.stream`; `stream` is non-functional without it). Surfaced during T0.4.                                                                                                                                                                                                                                  | orchestrator |
| 1.2.0   | Add optional `VehicleState.throttlePct` (VFR_HUD), `rcIn` (RC_CHANNELS), `rcOut` (SERVO_OUTPUT_RAW) so HUD/gauges can surface throttle + RC. Additive.                                                                                                                                                                                                     | orchestrator |
| 1.3.0   | Add optional `AppSettings.mapSource` (`MapSourceSetting`: url template + optional key) and `AppSettings.telemetryRateHz` for the Settings screen (T3.7, spec plan/04 §4.5). Additive.                                                                                                                                                                      | orchestrator |
| 1.4.0   | Refine `ExtContributes`: `panels`/`commands` become declarative metadata (`PanelContribution`/`CommandContribution` — id/title/icon\|shortcut) instead of full `PanelDef`/`CommandDef` carrying functions (which structured-clone drops on persist). Extensions register implementations at `activate()` via `ctx.ui` (T7.3, spec plan/06 §6.2). Additive. | orchestrator |
| 1.5.0   | App Settings pane: add optional `AppSettings.appearance` (`AppearanceSettings`: `themeMode`/`colors`/`density`/`lastSettingsSection`) + `AppSettings.keybinds` (command id → chord). New `ThemeMode`/`Density`/`AppearanceColorKey` types. All additive/optional — older persisted state stays valid.                                                      | orchestrator |
