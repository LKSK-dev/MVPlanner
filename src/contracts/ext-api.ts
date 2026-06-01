/**
 * Public extension API seam (impl 02 §2.7; spec plan/06 §6.4).
 * Semver-locked at M7 (spec plan/06 §6.10). FROZEN.
 */
import type { ConnState, TransportFactory } from './transport';
import type { VehicleState } from './vehicle';
import type { DecodedMessage } from './mavlink';
import type { CommandClient, ParamClient, MissionClient } from './microservices';
import type { UiRegistry } from './ui';
import type { MapEngine } from './map';

export type Permission =
  | 'telemetry:read'
  | 'mavlink:send'
  | 'command'
  | 'params:write'
  | 'mission:write'
  | 'ui:panel'
  | 'map'
  | 'notify'
  | 'files'
  | `net:${string}`
  | 'storage'
  | 'transport'
  | 'dialect';

/**
 * Declarative panel contribution (manifest metadata). Carries only
 * structured-cloneable metadata so the manifest persists to IndexedDB intact;
 * the extension registers the IMPLEMENTATION (`mount`) at `activate()` via
 * {@link ExtContext.ui}`.registerPanel` (contracts 1.4.0; spec plan/06 §6.2).
 */
export interface PanelContribution {
  id: string;
  title: string;
  icon?: string;
}

/**
 * Declarative command contribution (manifest metadata). The `run` implementation
 * is registered at `activate()` via {@link ExtContext.ui}`.registerCommand`
 * (contracts 1.4.0; spec plan/06 §6.2).
 */
export interface CommandContribution {
  id: string;
  title: string;
  shortcut?: string;
}

/**
 * Static contributions declared in the manifest. `panels`/`commands` are
 * DECLARATIVE metadata only (no functions) so the manifest survives
 * structured-clone persistence; implementations are registered at `activate()`
 * through {@link ExtContext.ui} (contracts 1.4.0; spec plan/06 §6.2).
 */
export interface ExtContributes {
  panels?: PanelContribution[];
  commands?: CommandContribution[];
  themes?: unknown[];
  mapLayers?: unknown[];
  transports?: unknown[];
  settings?: unknown[];
}

export interface ExtManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: string;
  description?: string;
  author?: string;
  permissions: Permission[];
  contributes?: ExtContributes;
  dependencies?: Record<string, string>;
  minAppVersion?: string;
  icon?: string;
  homepage?: string;
}

/** The `ctx` passed to extensions / the global `mvp` in scripting (spec plan/06 §6.4). */
export interface ExtContext {
  version: string;

  connection: {
    state(): ConnState;
    on(ev: 'state', cb: (s: ConnState) => void): () => void;
  };

  vehicles: {
    list(): VehicleState[];
    active(): VehicleState;
    on(ev: 'change', cb: () => void): () => void;
  };

  mavlink: {
    on(
      name: string,
      cb: (m: DecodedMessage) => void,
      o?: { sysid?: number; compid?: number; rateHz?: number },
    ): () => void;
    latest(name: string): DecodedMessage | undefined;
    rate(name: string): number;
    requestInterval(name: string, hz: number): void;
    /** perm: mavlink:send */
    send?(name: string, fields: Record<string, unknown>, o?: { signed?: boolean }): void;
    /** perm: dialect */
    loadDialect?(xmlOrJson: string): void;
  };

  /** Present only when the corresponding permission is granted. */
  command?: CommandClient;
  params?: ParamClient;
  mission?: MissionClient;

  ui?: UiRegistry & {
    registerWidget(...a: unknown[]): () => void;
    h(tag: string, props?: unknown, ...kids: unknown[]): unknown;
  };
  map?: MapEngine;
  theme?: { register(tokens: unknown): () => void };

  logs?: {
    openCurrentTlog(): unknown;
    queryDataFlash(expr: string, range: [number, number]): Promise<unknown>;
  };

  storage: {
    get<T>(k: string): Promise<T | undefined>;
    set<T>(k: string, v: T): Promise<void>;
  };

  files?: {
    openForRead(): Promise<Blob>;
    saveAs(b: Blob, name: string): Promise<void>;
  };

  /** perm: net:<host>; egress shown in UI (spec plan/07 §7.7). */
  net?: { fetch(url: string, init?: RequestInit): Promise<Response> };

  /** perm: transport */
  transports?: { register(f: TransportFactory): () => void };

  notify: { info(m: string): void; warn(m: string): void; error(m: string): void };
  log: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void };
  timers: { setInterval(fn: () => void, ms: number): () => void; raf(fn: () => void): () => void };
  events: {
    on(t: string, cb: (p: unknown) => void): () => void;
    emit(t: string, p: unknown): void;
  };
  onDispose(fn: () => void): void;
}
