/**
 * `ext/sandbox` public surface — the isolated extension runtime (task T7.2;
 * spec plan/06 §6.6, plan/08 §8.3).
 *
 * Implements the T7.1 {@link import('../host').ExtensionRuntime} seam by running
 * untrusted extension code in an isolated realm (a Web Worker in production; an
 * in-process {@link MessageChannel} for tests) and brokering every privileged
 * call through the T7.2 {@link import('../permissions').PermissionBroker}. The
 * in-guest `ctx` proxy exposes only granted methods; a {@link SandboxWatchdog}
 * terminates a runaway guest.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). See `./README.md`.
 */
export { createSandboxRuntime } from './runtime';
export type { SandboxRuntimeDeps, SandboxWatchdogConfig } from './runtime';
export { createInProcessSpawner } from './transport';
export type { GuestSpawner, SpawnedGuest, InProcessSpawnerOptions } from './transport';
export { startSandboxGuest } from './guest';
export type { GuestModule, GuestEvaluate, GuestOptions, GuestTimers } from './guest';
export { buildGuestCtx } from './proxy';
export type { SandboxCtx, BrokerCall } from './proxy';
export { SandboxWatchdog } from './watchdog';
export type { WatchdogOptions } from './watchdog';
export {
  GUEST_INIT,
  GUEST_ACTIVATE,
  GUEST_DEACTIVATE,
  BROKER_INVOKE,
  HOST_HEARTBEAT,
  narrowInit,
  narrowInvoke,
} from './protocol';
export type { InitRequest, InvokeRequest } from './protocol';
