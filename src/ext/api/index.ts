/**
 * `ext/api` public surface — the `mvp`/`ctx` extension API implementation (task
 * T7.3; spec plan/06 §6.4/§6.5/§6.10).
 *
 * Wires the FROZEN {@link import('../../contracts').ExtContext} over the injected
 * real services, gated by the {@link CAPABILITY_MAP} through the T7.2
 * {@link import('../permissions').PermissionBroker}:
 *  - {@link registerExtApi} registers every privileged method on the broker (the
 *    sandbox guest's surface, reached over RPC);
 *  - {@link assembleExtContext} builds the typed `ctx` for the trusted in-process
 *    runtime (vehicle-affecting calls share the same broker);
 *  - {@link createExtensionSystem} ties the host + runtime + broker + grants into
 *    the single object App instantiates;
 *  - {@link buildExtApiDts} surfaces the bundled `.d.ts` for editor autocomplete.
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). See `./README.md`.
 */
export { CAPABILITY_MAP, specForMethod } from './capability-map';
export type { ApiMethodSpec, OptionalGroup } from './capability-map';
export { registerExtApi } from './register';
export type { RegisterExtApiDeps } from './register';
export { assembleExtContext } from './context';
export type { AssembleExtContextDeps } from './context';
export { createExtensionSystem } from './system';
export type { ExtensionSystem, ExtensionSystemDeps, InstallRequest } from './system';
export { createEventsBus, makeLogSink } from './locals';
export type { EventsBus, ExtLogSink, ConsoleLike } from './locals';
export { buildExtApiDts, EXT_API_DTS } from './dts';
export type {
  ExtApiServices,
  ConnectionPort,
  VehiclesPort,
  MavlinkPort,
  MavlinkSubscribeOptions,
  UiPort,
  ThemePort,
  LogsPort,
  NetPort,
  FilesPort,
  TransportsPort,
  NotifyPort,
} from './ports';
