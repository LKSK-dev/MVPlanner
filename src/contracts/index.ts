/**
 * Frozen cross-module contracts barrel (impl 02). These seams enable safe
 * parallel implementation. Changes require orchestrator approval and a version
 * bump per the change-control rule (impl 00 §0.6).
 */

/**
 * Internal contract version. Bump on any seam change (minor = additive,
 * major = breaking) per the change-control rule (impl 00 §0.6).
 * - 1.0.0: initial frozen seams (T0.3).
 * - 1.1.0: add `Rpc.handleStream` (server counterpart to `Rpc.stream`).
 * - 1.2.0: add optional `VehicleState.throttlePct`/`rcIn`/`rcOut` (HUD/RC).
 * - 1.3.0: add optional `AppSettings.mapSource` + `AppSettings.telemetryRateHz`
 *   and the `MapSourceSetting` type for the Settings screen (T3.7). Additive.
 * - 1.4.0: refine `ExtContributes` — `panels`/`commands` are now DECLARATIVE
 *   metadata (`PanelContribution`/`CommandContribution`: id/title/icon|shortcut)
 *   instead of full `PanelDef`/`CommandDef` carrying functions, so a manifest
 *   survives structured-clone persistence; implementations register at
 *   `activate()` via `ctx.ui` (T7.3, spec plan/06 §6.2). Additive.
 */
export const CONTRACTS_VERSION = '1.6.0';

export type * from './bus';
export type * from './transport';
export type * from './mavlink';
export type * from './microservices';
export type * from './vehicle';
export type * from './store';
export type * from './ui';
export type * from './map';
export type * from './ext-api';
export type * from './storage';
