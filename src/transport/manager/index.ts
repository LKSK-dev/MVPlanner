/**
 * `transport/manager` public surface (T1.10; spec plan/03 §3.5 "Connection
 * manager", §3.7; plan/04 §4.1). The {@link ConnectionManager} owns one MAVLink
 * host, drives connect/disconnect, tracks the active vehicle, and surfaces link
 * diagnostics for the connection drawer + app wiring. Cross-module consumers
 * import from here, never deep paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the contract, owned files, and how to test it.
 */
export { ConnectionManager, createConnectionManager } from './connection-manager';
export type {
  ConnectionManagerOptions,
  ConnectionTelemetry,
  ConnectionStateListener,
  ConnectionTelemetryListener,
  HostTelemetry,
  MavlinkHostLike,
} from './connection-manager';
