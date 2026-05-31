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
 */
export const CONTRACTS_VERSION = '1.2.0';

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
