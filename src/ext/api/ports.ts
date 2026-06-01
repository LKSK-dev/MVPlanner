/**
 * Service ports the extension API wraps (task T7.3; spec plan/06 §6.4).
 *
 * The frozen {@link import('../../contracts').ExtContext} surface is assembled
 * over these *injected* ports — never over concrete singletons — so the whole
 * API layer is unit-testable with fakes and App can adapt the real services
 * (`src/mavlink/host`, `src/mavlink/microservices/*`, `src/ui/shell`,
 * `src/ui/widgets/map`, `src/data/storage`, `src/mavlink/dialects`) to them at
 * wire-up time.
 *
 * Each port mirrors exactly the slice of a real service that a `ctx.*` group
 * needs, so the adapters are thin pass-throughs and the permission gating lives
 * entirely in {@link import('./register').registerExtApi} + the broker.
 */
import type {
  CommandClient,
  ConnState,
  DecodedMessage,
  MapEngine,
  MissionClient,
  ParamClient,
  TransportFactory,
  UiRegistry,
  VehicleState,
} from '../../contracts';

/** Options accepted by {@link MavlinkPort.on} (matches the frozen `ctx.mavlink.on`). */
export interface MavlinkSubscribeOptions {
  sysid?: number;
  compid?: number;
  rateHz?: number;
}

/** Connection-state port (wraps `MavlinkHost.onState` + a state snapshot). */
export interface ConnectionPort {
  state(): ConnState;
  on(cb: (s: ConnState) => void): () => void;
}

/** Vehicle-model port (wraps the telemetry snapshot + active-vehicle selection). */
export interface VehiclesPort {
  list(): VehicleState[];
  active(): VehicleState;
  on(cb: () => void): () => void;
}

/** MAVLink read/write port (wraps `MavlinkHost` taps + the send/dialect paths). */
export interface MavlinkPort {
  on(name: string, cb: (m: DecodedMessage) => void, o?: MavlinkSubscribeOptions): () => void;
  latest(name: string): DecodedMessage | undefined;
  rate(name: string): number;
  requestInterval(name: string, hz: number): void;
  /** perm: `mavlink:send` (vehicle-affecting — confirm + audit). */
  send(name: string, fields: Record<string, unknown>, o?: { signed?: boolean }): void;
  /** perm: `dialect` — register extra message definitions at runtime. */
  loadDialect(xmlOrJson: string): void;
}

/** UI registry port: the frozen {@link UiRegistry} plus widget reuse + hyperscript. */
export interface UiPort extends UiRegistry {
  registerWidget(...a: unknown[]): () => void;
  h(tag: string, props?: unknown, ...kids: unknown[]): unknown;
}

/** Theme registration port (`ctx.theme`). */
export interface ThemePort {
  register(tokens: unknown): () => void;
}

/** Logs & data-analysis port (`ctx.logs`). */
export interface LogsPort {
  openCurrentTlog(): unknown;
  queryDataFlash(expr: string, range: [number, number]): Promise<unknown>;
}

/** Network egress port (`ctx.net`); the per-host gate lives in the broker. */
export interface NetPort {
  fetch(url: string, init?: RequestInit): Promise<Response>;
}

/**
 * File port (`ctx.files`) — matches the frozen `ExtContext.files` shape (a bare
 * {@link Blob} read), NOT the broader {@link import('../../contracts').FileIo}
 * seam; App adapts `FileIo` (which yields `{ name, blob }`) to this port.
 */
export interface FilesPort {
  openForRead(): Promise<Blob>;
  saveAs(b: Blob, name: string): Promise<void>;
}

/** Custom-transport registration port (`ctx.transports`). */
export interface TransportsPort {
  register(f: TransportFactory): () => void;
}

/** User-notification port (`ctx.notify`). */
export interface NotifyPort {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

/**
 * The bundle of real services the API wraps. Core groups are always present;
 * the advanced groups (`map`/`theme`/`logs`/`files`/`net`/`transports`) are
 * optional — a method whose backing service is absent is simply not registered
 * (so it is absent from the guest proxy and the assembled `ctx`), independent of
 * the grant.
 */
export interface ExtApiServices {
  connection: ConnectionPort;
  vehicles: VehiclesPort;
  mavlink: MavlinkPort;
  command: CommandClient;
  params: ParamClient;
  mission: MissionClient;
  ui: UiPort;
  notify: NotifyPort;
  map?: MapEngine;
  theme?: ThemePort;
  logs?: LogsPort;
  files?: FilesPort;
  net?: NetPort;
  transports?: TransportsPort;
}
