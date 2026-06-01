/**
 * `ext/host` public surface — the extension host/manager (task T7.1; spec
 * plan/06 §6.2/§6.3). Validates manifests, persists installs, owns activation
 * events + the dispose registry, and isolates faults. The sandboxed runtime
 * (T7.2) plugs into {@link ExtensionRuntime}; the real permission-brokered
 * context (T7.3) plugs into {@link ContextFactory}. See `./README.md`.
 */
export { ExtManifestError, toErrorMessage } from './errors';
export { parseManifest, isApiVersionCompatible } from './manifest';
export { parseSemVer, satisfiesRange } from './semver';
export type { SemVer } from './semver';
export { DisposeRegistry } from './dispose';
export { deriveActivationEvents } from './activation';
export type { ActivationEvent } from './activation';
export { createInProcessRuntime } from './runtime';
export type { ExtModule, ExtLoadRecord, LoadedExtension, ExtensionRuntime } from './runtime';
export { createExtKvStore } from './storage';
export type { ExtKvStore } from './storage';
export { ExtensionHost } from './host';
export type {
  ExtStatus,
  ExtState,
  InstallSource,
  ExtContextInput,
  ContextFactory,
  Watchdog,
  ExtensionHostDeps,
} from './host';
