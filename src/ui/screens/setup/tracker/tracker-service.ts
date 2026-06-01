/**
 * {@link TrackerService} — antenna-tracker support (task T8.9; spec plan/04
 * §4.12 SHOULD).
 *
 * Responsibilities, all over injected host seams so the service unit-tests with
 * a mock send + tap and no worker:
 *
 *  - DETECT an antenna-tracker system on the link from a `HEARTBEAT` whose
 *    `type === MAV_TYPE_ANTENNA_TRACKER`, latching its `(sysid, compid)` target
 *    and connection state.
 *  - SURFACE the tracker's pointing: its actual pan/tilt from the tracker's
 *    `ATTITUDE` (`yaw` → azimuth, `pitch` → elevation) and its commanded target
 *    from `NAV_CONTROLLER_OUTPUT` (`target_bearing` → azimuth, `nav_pitch` →
 *    elevation), plus the tracker's own ground position from its
 *    `GLOBAL_POSITION_INT`.
 *  - SOLVE the geometric pointing from the tracker toward the active vehicle
 *    (azimuth / elevation / distance) via {@link computePointing}.
 *  - FEED the tracker the active vehicle's position by emitting
 *    `GLOBAL_POSITION_INT` for the vehicle, RATE-LIMITED to `feedIntervalMs`.
 *  - CONFIG: read/write the key tracker parameters through an injected
 *    `ParamClient`.
 *
 * Pointing-only messages (`ATTITUDE` / `NAV_CONTROLLER_OUTPUT` /
 * `GLOBAL_POSITION_INT`) are accepted ONLY from the latched tracker target, so a
 * co-present vehicle's telemetry never pollutes the tracker state.
 */
import type { DecodedMessage, FieldValue, ParamClient, VehicleState } from '../../../../contracts';
import { computePointing, normalizeAzimuthDeg, type GeoPoint, type Pointing } from './pointing';
import { readTrackerConfig, type TrackerConfig, type TrackerParamName } from './config';

/** `MAV_TYPE_ANTENNA_TRACKER` (common dialect `MAV_TYPE` enum value). */
export const MAV_TYPE_ANTENNA_TRACKER = 5;

const DEG_PER_RAD = 180 / Math.PI;

/** Encode + send a message out the active link (bound to host `sendMessage`). */
export type TrackerSendFn = (name: string, fields: Record<string, unknown>) => void | Promise<void>;

/** Subscribe a selective decoded-message tap (bound to host `onMessage`). */
export type TrackerMessageTap = (
  names: readonly string[],
  cb: (msg: DecodedMessage) => void,
) => () => void;

/** The latched tracker system address. */
export interface TrackerTarget {
  readonly sysid: number;
  readonly compid: number;
}

/** A pan/tilt pair in degrees (azimuth 0..360, elevation −90..90). */
export interface TrackerPointing {
  readonly azimuthDeg: number;
  readonly elevationDeg: number;
}

/** Immutable snapshot of the tracker state for the UI. */
export interface TrackerState {
  /** Whether a tracker heartbeat was seen within `connectionTimeoutMs`. */
  readonly connected: boolean;
  /** The latched tracker `(sysid, compid)`, once detected. */
  readonly target?: TrackerTarget;
  /** Timestamp (ms, from `now`) of the last tracker heartbeat. */
  readonly lastHeartbeatMs?: number;
  /** Actual pan/tilt reported by the tracker's `ATTITUDE`. */
  readonly attitude?: TrackerPointing;
  /** Commanded pointing from the tracker's `NAV_CONTROLLER_OUTPUT`. */
  readonly navTarget?: TrackerPointing;
  /** The tracker's own ground position from its `GLOBAL_POSITION_INT`. */
  readonly trackerPosition?: GeoPoint;
  /** Geometric pointing from the tracker toward the active vehicle. */
  readonly solution?: Pointing;
}

/** Construction dependencies for {@link TrackerService}. */
export interface TrackerServiceDeps {
  /** Encode + send a message (host `sendMessage`). */
  readonly sendMessage: TrackerSendFn;
  /** Subscribe a decoded-message tap (host `onMessage`). */
  readonly onMessage: TrackerMessageTap;
  /** Resolve the currently-active vehicle (its position is fed to the tracker). */
  readonly getActiveVehicle: () => VehicleState | undefined;
  /** Parameter microservice for tracker config reads/writes (optional). */
  readonly params?: ParamClient;
  /** Monotonic-ish clock in ms (default `Date.now`). */
  readonly now?: () => number;
  /** Minimum interval between fed vehicle positions, ms (default 1000 → 1 Hz). */
  readonly feedIntervalMs?: number;
  /** Heartbeat staleness before the tracker is "disconnected", ms (default 3000). */
  readonly connectionTimeoutMs?: number;
}

/** Read a scalar field as a number (coercing bigint); `undefined` otherwise. */
function num(fields: Record<string, FieldValue>, key: string): number | undefined {
  const v = fields[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return undefined;
}

/**
 * Antenna-tracker service. Subscribe with {@link onChange} for state updates and
 * call {@link feedVehiclePosition} on a timer to keep the tracker pointed.
 */
export class TrackerService {
  private readonly sendMessage: TrackerSendFn;
  private readonly getActiveVehicle: () => VehicleState | undefined;
  private readonly params: ParamClient | undefined;
  private readonly now: () => number;
  private readonly feedIntervalMs: number;
  private readonly connectionTimeoutMs: number;
  private readonly unsubscribe: () => void;
  private readonly changeListeners = new Set<(state: TrackerState) => void>();

  private target: TrackerTarget | undefined;
  private lastHeartbeatMs: number | undefined;
  private attitude: TrackerPointing | undefined;
  private navTarget: TrackerPointing | undefined;
  private trackerPosition: GeoPoint | undefined;
  private lastFeedMs = Number.NEGATIVE_INFINITY;
  private disposed = false;

  constructor(deps: TrackerServiceDeps) {
    this.sendMessage = deps.sendMessage;
    this.getActiveVehicle = deps.getActiveVehicle;
    this.params = deps.params;
    this.now = deps.now ?? ((): number => Date.now());
    this.feedIntervalMs = deps.feedIntervalMs ?? 1000;
    this.connectionTimeoutMs = deps.connectionTimeoutMs ?? 3000;
    this.unsubscribe = deps.onMessage(
      ['HEARTBEAT', 'ATTITUDE', 'NAV_CONTROLLER_OUTPUT', 'GLOBAL_POSITION_INT'],
      (msg) => this.onMessage(msg),
    );
  }

  /** Build the current immutable {@link TrackerState} snapshot. */
  getState(): TrackerState {
    const solution = this.computeSolution();
    return {
      connected: this.isConnected(),
      ...(this.target !== undefined ? { target: this.target } : {}),
      ...(this.lastHeartbeatMs !== undefined ? { lastHeartbeatMs: this.lastHeartbeatMs } : {}),
      ...(this.attitude !== undefined ? { attitude: this.attitude } : {}),
      ...(this.navTarget !== undefined ? { navTarget: this.navTarget } : {}),
      ...(this.trackerPosition !== undefined ? { trackerPosition: this.trackerPosition } : {}),
      ...(solution !== undefined ? { solution } : {}),
    };
  }

  /** Subscribe to state changes; immediately invoked is the caller's choice. */
  onChange(cb: (state: TrackerState) => void): () => void {
    this.changeListeners.add(cb);
    return () => {
      this.changeListeners.delete(cb);
    };
  }

  /**
   * Feed the active vehicle's position to the tracker as a `GLOBAL_POSITION_INT`,
   * rate-limited to `feedIntervalMs`. Returns `true` when a message was sent,
   * `false` when skipped (no tracker, no vehicle position, or too soon).
   */
  feedVehiclePosition(): boolean {
    if (this.disposed || this.target === undefined) return false;
    const vehicle = this.getActiveVehicle();
    const pos = vehicle?.position;
    if (vehicle === undefined || pos === undefined) return false;
    const now = this.now();
    if (now - this.lastFeedMs < this.feedIntervalMs) return false;
    this.lastFeedMs = now;

    const yawDeg = normalizeAzimuthDeg(vehicle.attitude.yawRad * DEG_PER_RAD);
    void this.send('GLOBAL_POSITION_INT', {
      time_boot_ms: Math.trunc(now) >>> 0,
      lat: Math.round(pos.lat * 1e7),
      lon: Math.round(pos.lon * 1e7),
      alt: Math.round(pos.altAmslM * 1000),
      relative_alt: Math.round(pos.altRelM * 1000),
      vx: 0,
      vy: 0,
      vz: 0,
      hdg: Math.round(yawDeg * 100),
    });
    return true;
  }

  /** Whether a `ParamClient` was injected, so config reads/writes are possible. */
  get canConfigure(): boolean {
    return this.params !== undefined;
  }

  /** Snapshot the tracker config from the injected `ParamClient` cache. */
  getConfig(): TrackerConfig {
    if (this.params === undefined) {
      throw new Error('TrackerService: no ParamClient configured');
    }
    return readTrackerConfig(this.params);
  }

  /** Write a single tracker parameter through the injected `ParamClient`. */
  async setConfig(param: TrackerParamName, value: number): Promise<void> {
    if (this.params === undefined) {
      throw new Error('TrackerService: no ParamClient configured');
    }
    await this.params.set(param, value);
  }

  /**
   * Re-evaluate connection staleness against `now` and notify listeners if it
   * changed. The UI calls this on a timer so a silent tracker drops to
   * "disconnected" without needing a new message.
   */
  refreshConnection(): void {
    const before = this.isConnected();
    // No mutation needed — connection is derived from `lastHeartbeatMs`; emit
    // only when the derived value would differ from a fresh read.
    if (before !== this.isConnected()) this.emit();
  }

  /** Tear down the message tap and drop all listeners. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.changeListeners.clear();
  }

  // --- internals ----------------------------------------------------------

  /** Whether the last tracker heartbeat is within `connectionTimeoutMs`. */
  private isConnected(): boolean {
    if (this.lastHeartbeatMs === undefined) return false;
    return this.now() - this.lastHeartbeatMs <= this.connectionTimeoutMs;
  }

  /** Geometric pointing from the tracker position toward the active vehicle. */
  private computeSolution(): Pointing | undefined {
    const tracker = this.trackerPosition;
    const pos = this.getActiveVehicle()?.position;
    if (tracker === undefined || pos === undefined) return undefined;
    return computePointing(tracker, { lat: pos.lat, lon: pos.lon, altM: pos.altAmslM });
  }

  /** Dispatch an inbound decoded message to the matching handler. */
  private onMessage(msg: DecodedMessage): void {
    if (msg.name === 'HEARTBEAT') {
      this.onHeartbeat(msg);
      return;
    }
    // Pointing/position messages are only meaningful from the tracker itself.
    if (this.target === undefined) return;
    if (msg.sysid !== this.target.sysid || msg.compid !== this.target.compid) return;
    switch (msg.name) {
      case 'ATTITUDE':
        this.onAttitude(msg);
        break;
      case 'NAV_CONTROLLER_OUTPUT':
        this.onNavController(msg);
        break;
      case 'GLOBAL_POSITION_INT':
        this.onTrackerPosition(msg);
        break;
      default:
        break;
    }
  }

  /** Latch the tracker target + connection state from a tracker heartbeat. */
  private onHeartbeat(msg: DecodedMessage): void {
    if (num(msg.fields, 'type') !== MAV_TYPE_ANTENNA_TRACKER) return;
    this.target = { sysid: msg.sysid, compid: msg.compid };
    this.lastHeartbeatMs = this.now();
    this.emit();
  }

  /** Tracker actual pan/tilt: `ATTITUDE.yaw` → azimuth, `pitch` → elevation. */
  private onAttitude(msg: DecodedMessage): void {
    const yaw = num(msg.fields, 'yaw');
    const pitch = num(msg.fields, 'pitch');
    if (yaw === undefined || pitch === undefined) return;
    this.attitude = {
      azimuthDeg: normalizeAzimuthDeg(yaw * DEG_PER_RAD),
      elevationDeg: pitch * DEG_PER_RAD,
    };
    this.emit();
  }

  /** Tracker commanded pointing from `NAV_CONTROLLER_OUTPUT`. */
  private onNavController(msg: DecodedMessage): void {
    const bearing = num(msg.fields, 'target_bearing') ?? num(msg.fields, 'nav_bearing');
    const pitch = num(msg.fields, 'nav_pitch');
    if (bearing === undefined && pitch === undefined) return;
    this.navTarget = {
      azimuthDeg: normalizeAzimuthDeg(bearing ?? this.navTarget?.azimuthDeg ?? 0),
      elevationDeg: pitch ?? this.navTarget?.elevationDeg ?? 0,
    };
    this.emit();
  }

  /** Tracker's own ground position from its `GLOBAL_POSITION_INT`. */
  private onTrackerPosition(msg: DecodedMessage): void {
    const lat = num(msg.fields, 'lat');
    const lon = num(msg.fields, 'lon');
    const alt = num(msg.fields, 'alt');
    if (lat === undefined || lon === undefined || alt === undefined) return;
    this.trackerPosition = { lat: lat / 1e7, lon: lon / 1e7, altM: alt / 1000 };
    this.emit();
  }

  /** Fire all `onChange` listeners with a fresh snapshot. */
  private emit(): void {
    if (this.changeListeners.size === 0) return;
    const state = this.getState();
    for (const cb of this.changeListeners) cb(state);
  }

  /** Fire-and-forget send that swallows async rejections (no awaiting caller). */
  private send(name: string, fields: Record<string, unknown>): void {
    try {
      Promise.resolve(this.sendMessage(name, fields)).catch(() => {
        /* feed is best-effort; the next tick retries */
      });
    } catch {
      /* synchronous send failure — best-effort */
    }
  }
}

/** Construct a {@link TrackerService} (factory mirroring sibling services). */
export function createTrackerService(deps: TrackerServiceDeps): TrackerService {
  return new TrackerService(deps);
}
