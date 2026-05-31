/**
 * {@link VehicleModel} — derives a typed {@link VehicleState} per `(sysid,
 * compid)` from decoded MAVLink (task T1.5; spec plan/03 §3.3, plan/04 §4.11).
 *
 * INTERNAL module: it consumes the FROZEN {@link DecodedMessage} type and
 * produces the FROZEN {@link VehicleState} shape. It implements no contract
 * interface. Pure/testable: the clock is injectable and the only inputs are
 * decoded messages, so it builds against synthetic `DecodedMessage` objects.
 *
 * Out of scope: link statistics. `VehicleState.link` is a {@link LinkStats}
 * owned by the transport + registry; this model defaults it to zeros and the
 * worker host (T1.9) fills it from the registry before publishing to the UI.
 */
import type { DecodedMessage, FieldValue, LinkStats, VehicleState } from '../contracts';
import { classifyMavType, decodeMode } from './mode-maps';

/** `MAV_MODE_FLAG_SAFETY_ARMED` bit of `HEARTBEAT.base_mode`. */
const MAV_MODE_FLAG_SAFETY_ARMED = 0x80;
/** `MAV_SYS_STATUS_AHRS` sensor bit of the SYS_STATUS health bitmasks. */
const MAV_SYS_STATUS_AHRS = 0x200000;
/** `UINT16_MAX` — MAVLink "field unknown/not measured" sentinel for uint16. */
const UINT16_MAX = 0xffff;

// EKF_STATUS_REPORT.flags bits (EKF_STATUS_FLAGS) used for the health heuristic.
const EKF_ATTITUDE = 0x01;
const EKF_VELOCITY_HORIZ = 0x02;
const EKF_POS_HORIZ_REL = 0x08;
const EKF_POS_HORIZ_ABS = 0x10;
const EKF_UNINITIALIZED = 0x400;

/** Read a scalar field as a number (coercing bigint); `undefined` otherwise. */
function num(fields: Record<string, FieldValue>, key: string): number | undefined {
  const v = fields[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return undefined;
}

/** Read element `i` of an array-typed field as a number, or `undefined`. */
function numAt(fields: Record<string, FieldValue>, key: string, i: number): number | undefined {
  const v = fields[key];
  if (Array.isArray(v)) {
    const e = v[i];
    return typeof e === 'number' ? e : undefined;
  }
  return undefined;
}

/** A fresh zeroed {@link LinkStats}; the worker host overwrites this (T1.9). */
function zeroLink(): LinkStats {
  return { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false };
}

/** Format an ArduPilot/PX4 `flight_sw_version` (`MMmmpp__`) as `major.minor.patch`. */
function formatFwVersion(v: number): string {
  const major = (v >>> 24) & 0xff;
  const minor = (v >>> 16) & 0xff;
  const patch = (v >>> 8) & 0xff;
  return `${major}.${minor}.${patch}`;
}

/** Options for {@link VehicleModel}. */
export interface VehicleModelOptions {
  /** Time source used when `ingest` is called without an explicit `nowMs`. */
  clock?: () => number;
}

/** Listener invoked with a snapshot copy whenever a vehicle's state changes. */
export type VehicleChangeListener = (state: VehicleState) => void;

function vehKey(sysid: number, compid: number): string {
  return `${sysid}:${compid}`;
}

/** Deep-ish copy so callers cannot mutate the model's internal state. */
function cloneState(s: VehicleState): VehicleState {
  return {
    ...s,
    attitude: { ...s.attitude },
    link: { ...s.link },
    ...(s.position ? { position: { ...s.position } } : {}),
    ...(s.velocity ? { velocity: { ...s.velocity } } : {}),
    ...(s.battery ? { battery: { ...s.battery } } : {}),
    ...(s.gps ? { gps: { ...s.gps } } : {}),
    ...(s.home ? { home: { ...s.home } } : {}),
    ...(s.vibe ? { vibe: { ...s.vibe } } : {}),
  };
}

/**
 * Ingests {@link DecodedMessage}s and maintains one {@link VehicleState} per
 * `(sysid, compid)`. Memory is bounded by the number of distinct systems (no
 * per-vehicle history is retained).
 */
export class VehicleModel {
  private readonly vehicles = new Map<string, VehicleState>();
  private readonly listeners = new Set<VehicleChangeListener>();
  private readonly clock: () => number;

  constructor(options: VehicleModelOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
  }

  /**
   * Ingest one decoded message, updating the matching vehicle's derived state.
   * `nowMs` overrides the injected clock (deterministic in tests). Messages that
   * carry no vehicle-model signal are ignored (no vehicle is created for them).
   */
  ingest(msg: DecodedMessage, nowMs?: number): void {
    const now = nowMs ?? this.clock();
    const changed = this.apply(msg, now);
    if (changed) {
      const state = this.vehicles.get(vehKey(msg.sysid, msg.compid));
      if (state) this.emit(state);
    }
  }

  /** Current derived state for a vehicle, or `undefined` if none seen. */
  getState(sysid: number, compid: number): VehicleState | undefined {
    const s = this.vehicles.get(vehKey(sysid, compid));
    return s ? cloneState(s) : undefined;
  }

  /** All known vehicles, sorted by `(sysid, compid)`. */
  listVehicles(): VehicleState[] {
    return this.snapshot();
  }

  /** Snapshot copies of every vehicle, sorted by `(sysid, compid)`. */
  snapshot(): VehicleState[] {
    const out: VehicleState[] = [];
    for (const s of this.vehicles.values()) out.push(cloneState(s));
    out.sort((a, b) => a.sysid - b.sysid || a.compid - b.compid);
    return out;
  }

  /** Subscribe to per-vehicle change notifications; returns an unsubscribe fn. */
  onChange(listener: VehicleChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Drop all accumulated vehicle state. */
  clear(): void {
    this.vehicles.clear();
  }

  private emit(state: VehicleState): void {
    if (this.listeners.size === 0) return;
    const copy = cloneState(state);
    for (const l of this.listeners) l(copy);
  }

  /** Get-or-create the mutable state record for a source. */
  private ensure(sysid: number, compid: number): VehicleState {
    const key = vehKey(sysid, compid);
    let s = this.vehicles.get(key);
    if (s === undefined) {
      s = {
        sysid,
        compid,
        mavType: 0,
        autopilot: 0,
        vehicleClass: 'unknown',
        armed: false,
        mode: '',
        attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
        link: zeroLink(),
        lastHeartbeatMs: 0,
      };
      this.vehicles.set(key, s);
    }
    return s;
  }

  /** Apply one message to the matching vehicle; returns whether it changed. */
  private apply(msg: DecodedMessage, now: number): boolean {
    const f = msg.fields;
    switch (msg.name) {
      case 'HEARTBEAT':
        return this.applyHeartbeat(msg, f, now);
      case 'GLOBAL_POSITION_INT':
        return this.applyGlobalPosition(msg, f);
      case 'VFR_HUD':
        return this.applyVfrHud(msg, f);
      case 'ATTITUDE':
        return this.applyAttitude(msg, f);
      case 'SYS_STATUS':
        return this.applySysStatus(msg, f);
      case 'BATTERY_STATUS':
        return this.applyBatteryStatus(msg, f);
      case 'GPS_RAW_INT':
        return this.applyGpsRaw(msg, f);
      case 'EKF_STATUS_REPORT':
        return this.applyEkfStatus(msg, f);
      case 'HOME_POSITION':
        return this.applyHome(msg, f);
      case 'AUTOPILOT_VERSION':
        return this.applyAutopilotVersion(msg, f);
      case 'VIBRATION':
        return this.applyVibration(msg, f);
      default:
        return false;
    }
  }

  private applyHeartbeat(msg: DecodedMessage, f: Record<string, FieldValue>, now: number): boolean {
    const type = num(f, 'type');
    const autopilot = num(f, 'autopilot');
    const baseMode = num(f, 'base_mode');
    const customMode = num(f, 'custom_mode');
    if (type === undefined || autopilot === undefined) return false;
    const s = this.ensure(msg.sysid, msg.compid);
    s.mavType = type;
    s.autopilot = autopilot;
    s.vehicleClass = classifyMavType(type);
    s.armed = baseMode !== undefined && (baseMode & MAV_MODE_FLAG_SAFETY_ARMED) !== 0;
    if (customMode !== undefined) {
      s.mode = decodeMode(s.vehicleClass, autopilot, customMode);
    }
    s.lastHeartbeatMs = now;
    return true;
  }

  private applyGlobalPosition(msg: DecodedMessage, f: Record<string, FieldValue>): boolean {
    const lat = num(f, 'lat');
    const lon = num(f, 'lon');
    const alt = num(f, 'alt');
    const relAlt = num(f, 'relative_alt');
    if (lat === undefined || lon === undefined || alt === undefined || relAlt === undefined) {
      return false;
    }
    const s = this.ensure(msg.sysid, msg.compid);
    s.position = {
      lat: lat / 1e7,
      lon: lon / 1e7,
      altRelM: relAlt / 1000,
      altAmslM: alt / 1000,
    };
    const vx = num(f, 'vx');
    const vy = num(f, 'vy');
    const vz = num(f, 'vz');
    if (vx !== undefined && vy !== undefined && vz !== undefined) {
      const groundMs = Math.hypot(vx, vy) / 100;
      const climbMs = -vz / 100;
      const airMs = s.velocity?.airMs;
      s.velocity = { groundMs, climbMs, ...(airMs !== undefined ? { airMs } : {}) };
    }
    return true;
  }

  private applyVfrHud(msg: DecodedMessage, f: Record<string, FieldValue>): boolean {
    const groundspeed = num(f, 'groundspeed');
    const climb = num(f, 'climb');
    if (groundspeed === undefined || climb === undefined) return false;
    const s = this.ensure(msg.sysid, msg.compid);
    const airMs = num(f, 'airspeed') ?? s.velocity?.airMs;
    s.velocity = {
      groundMs: groundspeed,
      climbMs: climb,
      ...(airMs !== undefined ? { airMs } : {}),
    };
    return true;
  }

  private applyAttitude(msg: DecodedMessage, f: Record<string, FieldValue>): boolean {
    const roll = num(f, 'roll');
    const pitch = num(f, 'pitch');
    const yaw = num(f, 'yaw');
    if (roll === undefined || pitch === undefined || yaw === undefined) return false;
    const s = this.ensure(msg.sysid, msg.compid);
    s.attitude = { rollRad: roll, pitchRad: pitch, yawRad: yaw };
    return true;
  }

  private applySysStatus(msg: DecodedMessage, f: Record<string, FieldValue>): boolean {
    const s = this.ensure(msg.sysid, msg.compid);
    let changed = false;

    const voltage = num(f, 'voltage_battery');
    if (voltage !== undefined && voltage !== UINT16_MAX) {
      const current = num(f, 'current_battery');
      const remaining = num(f, 'battery_remaining');
      const currentA =
        current !== undefined && current !== -1 ? current / 100 : s.battery?.currentA;
      const remainingPct =
        remaining !== undefined && remaining !== -1 ? remaining : s.battery?.remainingPct;
      const consumedmAh = s.battery?.consumedmAh;
      s.battery = {
        voltageV: voltage / 1000,
        ...(currentA !== undefined ? { currentA } : {}),
        ...(remainingPct !== undefined ? { remainingPct } : {}),
        ...(consumedmAh !== undefined ? { consumedmAh } : {}),
      };
      changed = true;
    }

    const present = num(f, 'onboard_control_sensors_present');
    const health = num(f, 'onboard_control_sensors_health');
    if (present !== undefined && health !== undefined && (present & MAV_SYS_STATUS_AHRS) !== 0) {
      s.ekfOk = (health & MAV_SYS_STATUS_AHRS) !== 0;
      changed = true;
    }
    return changed;
  }

  private applyBatteryStatus(msg: DecodedMessage, f: Record<string, FieldValue>): boolean {
    const s = this.ensure(msg.sysid, msg.compid);
    const cell0 = numAt(f, 'voltages', 0);
    const current = num(f, 'current_battery');
    const consumed = num(f, 'current_consumed');
    const remaining = num(f, 'battery_remaining');
    const voltageV =
      cell0 !== undefined && cell0 !== UINT16_MAX ? cell0 / 1000 : s.battery?.voltageV;
    if (voltageV === undefined) return false;
    const currentA = current !== undefined && current !== -1 ? current / 100 : s.battery?.currentA;
    const consumedmAh =
      consumed !== undefined && consumed !== -1 ? consumed : s.battery?.consumedmAh;
    const remainingPct =
      remaining !== undefined && remaining !== -1 ? remaining : s.battery?.remainingPct;
    s.battery = {
      voltageV,
      ...(currentA !== undefined ? { currentA } : {}),
      ...(consumedmAh !== undefined ? { consumedmAh } : {}),
      ...(remainingPct !== undefined ? { remainingPct } : {}),
    };
    return true;
  }

  private applyGpsRaw(msg: DecodedMessage, f: Record<string, FieldValue>): boolean {
    const fix = num(f, 'fix_type');
    const sats = num(f, 'satellites_visible');
    const eph = num(f, 'eph');
    if (fix === undefined || sats === undefined) return false;
    const s = this.ensure(msg.sysid, msg.compid);
    s.gps = { fix, sats, hdop: eph !== undefined && eph !== UINT16_MAX ? eph / 100 : 0 };
    return true;
  }

  private applyEkfStatus(msg: DecodedMessage, f: Record<string, FieldValue>): boolean {
    const flags = num(f, 'flags');
    if (flags === undefined) return false;
    const s = this.ensure(msg.sysid, msg.compid);
    const hasAttitude = (flags & EKF_ATTITUDE) !== 0;
    const hasVel = (flags & EKF_VELOCITY_HORIZ) !== 0;
    const hasPos = (flags & (EKF_POS_HORIZ_REL | EKF_POS_HORIZ_ABS)) !== 0;
    const uninitialised = (flags & EKF_UNINITIALIZED) !== 0;
    s.ekfOk = hasAttitude && hasVel && hasPos && !uninitialised;
    return true;
  }

  private applyHome(msg: DecodedMessage, f: Record<string, FieldValue>): boolean {
    const lat = num(f, 'latitude');
    const lon = num(f, 'longitude');
    const alt = num(f, 'altitude');
    if (lat === undefined || lon === undefined || alt === undefined) return false;
    const s = this.ensure(msg.sysid, msg.compid);
    s.home = { lat: lat / 1e7, lon: lon / 1e7, altM: alt / 1000 };
    return true;
  }

  private applyAutopilotVersion(msg: DecodedMessage, f: Record<string, FieldValue>): boolean {
    const fw = num(f, 'flight_sw_version');
    if (fw === undefined) return false;
    const s = this.ensure(msg.sysid, msg.compid);
    s.firmware = formatFwVersion(fw);
    return true;
  }

  private applyVibration(msg: DecodedMessage, f: Record<string, FieldValue>): boolean {
    const x = num(f, 'vibration_x');
    const y = num(f, 'vibration_y');
    const z = num(f, 'vibration_z');
    if (x === undefined || y === undefined || z === undefined) return false;
    const s = this.ensure(msg.sysid, msg.compid);
    s.vibe = { x, y, z };
    return true;
  }
}
