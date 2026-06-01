/**
 * App/connection-scoped Flight services (task T2.11; spec plan/04 §4.2,
 * plan/07 §7.4, plan/08 §8.2/§8.3).
 *
 * These services are instantiated ONCE where the MAVLink host lives ({@link App})
 * and handed to the Flight screen, so recording, the action audit log, the
 * command microservice and the STATUSTEXT accumulator all SURVIVE screen
 * switches (the screen panel is re-mounted on every visit; the services are not):
 *
 *  - {@link FlightServices.command} — a {@link CommandClient} bound to the host
 *    (`sendMessage` + `onMessage`) whose active vehicle is read from the store;
 *  - {@link FlightServices.param} / {@link FlightServices.paramMeta} /
 *    {@link FlightServices.presetStore} — the app-scoped {@link ParamClient},
 *    {@link ParamMetaStore} and preset store the Config screen (T3.4/T3.6/T3.5)
 *    shares, so the parameter set is fetched once and reused across screens;
 *  - {@link FlightServices.audit} — one shared {@link AuditLog} for every action
 *    (UI + map-guided), reachable via the audit viewer;
 *  - {@link FlightServices.recorder} — a {@link TlogRecorder} over the host's
 *    never-dropped raw-frame tap + storage, auto-starting on connect;
 *  - {@link FlightServices.statusMessages} — a bounded, reactive STATUSTEXT
 *    buffer fed by `host.onMessage(['STATUSTEXT'])` via
 *    {@link statusMessageFromDecoded};
 *  - {@link FlightServices.quickWatchSource} — a host inspector adapter for the
 *    quick-watch widget.
 *
 * The host slice is the structural {@link FlightHost}; the real
 * {@link import('../../../mavlink/host').MavlinkHost} satisfies it. Everything is
 * disposed via the returned {@link FlightServicesHandle.dispose}.
 */
import { createSignal, type Accessor } from 'solid-js';
import type {
  AppState,
  BlobStore,
  CalibrationClient,
  CommandClient,
  DecodedMessage,
  FieldValue,
  FileIo,
  MissionClient,
  ParamClient,
  Store,
  VehicleState,
} from '../../../contracts';
import { createCalibrationClient } from '../../../mavlink/microservices/calibration';
import { createCommandClient } from '../../../mavlink/microservices/command';
import { createMissionClient } from '../../../mavlink/microservices/mission';
import { createParamClient } from '../../../mavlink/microservices/param';
import { createTerrainService } from '../../../mavlink/microservices/terrain';
import {
  createElevationProvider,
  createImageDecoder,
  isImageDecoderAvailable,
  type ElevationProvider,
  type TileDecoder,
} from '../../../geo/terrain';
import { createTileCache } from '../../../geo/tiles';
import { createParamMetaStore, type ParamMetaStore } from '../../../mavlink/param-meta';
import { createPresetStore, type PresetStore } from '../../../data/paramfile';
import { createAuditLog, type AuditLog } from '../../../core/audit';
import { TlogRecorder } from '../../../data/tlog';
import type { RawFrameLike } from '../../../data/tlog';
import type { AppStorage } from '../../../data/storage';
import { statusMessageFromDecoded, type StatusMessage } from '../../../ui/widgets/messages';
import type { QuickWatchField, QuickWatchSource } from '../../../ui/widgets/quickwatch';

/** One on-demand inspector row the quick-watch adapter reads (host projection). */
interface InspectorRowLike {
  readonly name: string;
  readonly fields: Record<string, FieldValue>;
}

/** An on-demand inspector snapshot the quick-watch adapter reads. */
interface InspectorSnapshotLike {
  readonly rows: readonly InspectorRowLike[];
}

/**
 * The structural slice of the MAVLink host the Flight services need. The real
 * {@link import('../../../mavlink/host').MavlinkHost} satisfies it; tests pass a
 * lightweight fake. `subscribeInspector` is optional (a bare mock omits it, and
 * the quick-watch source then simply reports no fields).
 */
export interface FlightHost {
  /** Encode + send a message out the active link. */
  sendMessage(name: string, fields: Record<string, unknown>): void | Promise<void>;
  /** Subscribe a selective decoded-message tap; returns an unsubscribe fn. */
  onMessage(names: readonly string[], cb: (msg: DecodedMessage) => void): () => void;
  /** Subscribe the never-dropped raw-frame tap (tlog recording). */
  onRawFrame(cb: (frame: RawFrameLike) => void): () => void;
  /** Subscribe to connection-state transitions (auto-start-on-connect). */
  onState(cb: (state: { kind: string }) => void): () => void;
  /** Subscribe the on-demand inspector stream (quick-watch field source). */
  subscribeInspector?(
    cb: (snap: InspectorSnapshotLike) => void,
    opts?: { hz?: number },
  ): () => void;
}

/** The app/connection-scoped services the Flight + Config screens consume. */
export interface FlightServices {
  /** Command microservice bound to the host + store active vehicle. */
  readonly command: CommandClient;
  /**
   * Calibration microservice (accel 6-point/level, onboard compass `MAG_CAL`,
   * gyro, radio capture) bound to the host + store active vehicle. App/
   * connection-scoped so a running calibration survives a Setup ⇄ Flight screen
   * switch. Consumed by the Setup screen (T5.12).
   */
  readonly calibration: CalibrationClient;
  /**
   * Mission microservice (mission/fence/rally up/download + verify) bound to the
   * host + store active vehicle. App/connection-scoped so an in-flight transfer
   * survives a Plan ⇄ Flight screen switch.
   */
  readonly mission: MissionClient;
  /**
   * Parameter microservice bound to the host + store active vehicle. App-scoped
   * (fetched once, shared across the Parameters + Tuning Config tabs).
   */
  readonly param: ParamClient;
  /** Shared parameter metadata resolver (the curated `ParamMetaStore`). */
  readonly paramMeta: ParamMetaStore;
  /** Persistent named-preset store (over the storage KV). */
  readonly presetStore: PresetStore;
  /** Shared action audit log (UI + map-guided actions, audit viewer). */
  readonly audit: AuditLog;
  /** tlog recorder over the host raw-frame tap + storage (auto-on-connect). */
  readonly recorder: TlogRecorder;
  /** Reactive, bounded STATUSTEXT buffer for the console + HUD ticker. */
  readonly statusMessages: Accessor<readonly StatusMessage[]>;
  /** Blob store for the map tile cache. */
  readonly blobs: BlobStore;
  /** File picker I/O for mission/plan file load/save (Plan screen). */
  readonly files: FileIo;
  /**
   * Terrain elevation provider (over a storage-backed terrain tile cache) the
   * Plan screen samples for the elevation profile, and the TERRAIN microservice
   * serves to the vehicle.
   */
  readonly terrainProvider: ElevationProvider;
  /** Live numeric-field source for the quick-watch widget. */
  readonly quickWatchSource: QuickWatchSource;
}

/** Construction dependencies for {@link createFlightServices}. */
export interface FlightServicesDeps {
  /** The MAVLink host (real worker host, or a fake in tests). */
  readonly host: FlightHost;
  /** The shared app store (active-vehicle source for the command client). */
  readonly store: Store<AppState>;
  /** The storage foundation (blobs for tiles, files for tlog export). */
  readonly storage: AppStorage;
  /** Cap on retained STATUSTEXT entries (default 1000). */
  readonly maxStatusMessages?: number;
  /** Clock for STATUSTEXT timestamps (default `Date.now`). */
  readonly now?: () => number;
}

/** The services plus a disposer that tears down every subscription. */
export interface FlightServicesHandle {
  /** The services handed to the Flight screen. */
  readonly services: FlightServices;
  /** Tear down the command client, recorder, and STATUSTEXT subscription. */
  readonly dispose: () => Promise<void>;
}

/** Default cap on retained STATUSTEXT entries. */
const DEFAULT_MAX_STATUS = 1000;

/** Wrap the platform `fetch` as a tile-cache fetch seam (terrain tiles). */
function platformFetch(url: string, init?: { signal?: AbortSignal }): Promise<Response> {
  return fetch(url, init);
}

/**
 * Pick a terrain tile decoder: the browser `createImageBitmap`/`OffscreenCanvas`
 * decoder when available, else a rejecting stub so elevation samples degrade to
 * `undefined` (no throw) in non-browser/test contexts.
 */
function pickTileDecoder(): TileDecoder {
  if (isImageDecoderAvailable()) return createImageDecoder();
  return () => Promise.reject(new Error('tile decoder unavailable'));
}

/** Resolve the store's currently-active vehicle (non-reactive snapshot read). */
function activeVehicleOf(store: Store<AppState>): VehicleState | undefined {
  const s = store.get();
  if (s.activeSysid === undefined) return undefined;
  return s.vehicles[s.activeSysid];
}

/**
 * Build a {@link QuickWatchSource} over the host's on-demand inspector stream:
 * it exposes every observed NUMERIC `message.field` and samples the latest
 * value. When the host has no inspector stream (a bare mock), it reports no
 * fields and never notifies.
 */
function createInspectorWatchSource(host: FlightHost): QuickWatchSource {
  let rows: readonly InspectorRowLike[] = [];

  const numericFields = (): QuickWatchField[] => {
    const seen = new Set<string>();
    const out: QuickWatchField[] = [];
    for (const row of rows) {
      for (const [field, value] of Object.entries(row.fields)) {
        if (typeof value !== 'number' && typeof value !== 'bigint') continue;
        const key = `${row.name}.${field}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ msg: row.name, field });
      }
    }
    return out;
  };

  return {
    listFields: () => numericFields(),
    sample(msg: string, field: string): number | undefined {
      for (const row of rows) {
        if (row.name !== msg) continue;
        const value = row.fields[field];
        if (typeof value === 'number') return value;
        if (typeof value === 'bigint') return Number(value);
      }
      return undefined;
    },
    subscribe(cb: () => void): () => void {
      if (host.subscribeInspector === undefined) return () => undefined;
      return host.subscribeInspector(
        (snap) => {
          rows = snap.rows;
          cb();
        },
        { hz: 4 },
      );
    },
  };
}

/**
 * Construct the app/connection-scoped Flight services. Call ONCE where the host
 * is owned ({@link App}); dispose via the returned handle when the host is
 * disposed.
 */
export function createFlightServices(deps: FlightServicesDeps): FlightServicesHandle {
  const { host, store, storage } = deps;
  const now = deps.now ?? ((): number => Date.now());
  const maxStatus = Math.max(1, deps.maxStatusMessages ?? DEFAULT_MAX_STATUS);

  const command = createCommandClient({
    sendMessage: (name, fields) => host.sendMessage(name, fields),
    onMessage: (names, cb) => host.onMessage(names, cb),
    getActiveVehicle: () => activeVehicleOf(store),
  });

  const targetOf = (): { sysid: number; compid: number } | undefined => {
    const v = activeVehicleOf(store);
    return v === undefined ? undefined : { sysid: v.sysid, compid: v.compid };
  };

  const mission = createMissionClient({
    sendMessage: (name, fields) => host.sendMessage(name, fields),
    onMessage: (names, cb) => host.onMessage(names, cb),
    getTarget: targetOf,
  });

  const calibration = createCalibrationClient({
    command,
    onMessage: (names, cb) => host.onMessage(names, cb),
    getTarget: targetOf,
  });

  // Terrain: a storage-backed terrain tile cache + elevation provider, plus the
  // TERRAIN microservice that serves TERRAIN_DATA to the vehicle from it.
  const terrainTiles = createTileCache({ blobs: storage.blobs, fetch: platformFetch });
  const terrainProvider = createElevationProvider({
    tiles: terrainTiles,
    decode: pickTileDecoder(),
  });
  const terrainService = createTerrainService({
    sendMessage: (name, fields) => host.sendMessage(name, fields),
    onMessage: (names, cb) => host.onMessage(names, cb),
    elevation: terrainProvider,
  });

  const param = createParamClient({
    sendMessage: (name, fields) => host.sendMessage(name, fields),
    onMessage: (names, cb) => host.onMessage(names, cb),
    getTarget: targetOf,
  });
  const paramMeta = createParamMetaStore();
  const presetStore = createPresetStore(storage.kv);

  const audit = createAuditLog();

  const recorder = new TlogRecorder({
    source: host,
    blobs: storage.blobs,
    fileIo: storage.files,
    autoStartOnConnect: true,
  });

  const [statusMessages, setStatusMessages] = createSignal<readonly StatusMessage[]>([]);
  let seq = 0;
  const offStatus = host.onMessage(['STATUSTEXT'], (msg) => {
    const entry = statusMessageFromDecoded(msg, now(), seq++);
    setStatusMessages((prev) => {
      const next = prev.length >= maxStatus ? prev.slice(prev.length - maxStatus + 1) : [...prev];
      next.push(entry);
      return next;
    });
  });

  const quickWatchSource = createInspectorWatchSource(host);

  const services: FlightServices = {
    command,
    calibration,
    mission,
    param,
    paramMeta,
    presetStore,
    audit,
    recorder,
    statusMessages,
    blobs: storage.blobs,
    files: storage.files,
    terrainProvider,
    quickWatchSource,
  };

  const dispose = async (): Promise<void> => {
    offStatus();
    command.dispose();
    calibration.dispose();
    mission.dispose();
    terrainService.dispose();
    param.dispose();
    await recorder.dispose();
  };

  return { services, dispose };
}
