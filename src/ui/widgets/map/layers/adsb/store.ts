/**
 * Pure ADS-B traffic store (task T8.8; spec plan/04 §4.2 ADSB display-only).
 *
 * The store ingests decoded MAVLink `ADSB_VEHICLE` messages, keys aircraft by
 * `ICAO_address`, converts MAVLink wire units into UI-friendly values and ages
 * entries out from an injected clock. It has no DOM, Solid or canvas dependency;
 * the only live integration seam is {@link connectTrafficStore}, which wires a
 * MAVLink host-style `onMessage` tap to the store.
 */
import type { DecodedMessage, FieldValue } from '../../../../../contracts';

/** A testable clock returning milliseconds since an arbitrary epoch. */
export type TrafficNow = () => number;

/** Default stale timeout for aircraft whose last ADS-B communication is old. */
export const DEFAULT_TRAFFIC_STALE_TIMEOUT_MS = 60_000;

/** The decoded, normalized traffic shape consumed by the ADS-B map layer. */
export interface TrafficAircraft {
  /** Numeric ICAO address from MAVLink `ICAO_address`. */
  icaoAddress: number;
  /** Uppercase hexadecimal ICAO label, zero-padded to at least six digits. */
  icaoHex: string;
  /** Latitude in WGS84 degrees. */
  lat: number;
  /** Longitude in WGS84 degrees. */
  lon: number;
  /** Altitude in metres (MAVLink `altitude` is millimetres). */
  altitudeM: number;
  /** Heading in degrees clockwise from north (MAVLink `heading` is centidegrees). */
  headingDeg: number;
  /** Horizontal velocity in metres/second (MAVLink `hor_velocity` is cm/s). */
  horizontalVelocityMps: number;
  /** Trimmed callsign, or an empty string when none was sent. */
  callsign: string;
  /** MAVLink ADSB_EMITTER_TYPE enum value. */
  emitterType: number;
  /** Time since last communication as reported by ADS-B, seconds. */
  tslcSec: number;
  /** Raw MAVLink ADSB_FLAGS bitmask. */
  flags: number;
  /** Time this MAVLink frame was received by MVPlanner. */
  receivedAtMs: number;
  /** Estimated aircraft last-communication time: `receivedAtMs - tslcSec * 1000`. */
  lastSeenMs: number;
}

/** Options for {@link TrafficStore}. */
export interface TrafficStoreOptions {
  /** Injected clock; defaults to `Date.now`. */
  now?: TrafficNow;
  /** Drop aircraft when `now - lastSeenMs` exceeds this value. */
  staleTimeoutMs?: number;
}

/** Minimal MAVLink message-source seam; implemented by `MavlinkHost.onMessage`. */
export interface AdsbMessageSource {
  /** Subscribe to selected decoded MAVLink messages. */
  onMessage(names: readonly string[], cb: (msg: DecodedMessage) => void): () => void;
}

/** Options for {@link connectTrafficStore}. */
export interface TrafficStoreTapOptions {
  /** Optional clock for the tap; otherwise the store's own injected clock is used. */
  now?: TrafficNow;
}

/** In-memory ADS-B traffic store keyed by ICAO address. */
export class TrafficStore {
  private readonly nowFn: TrafficNow;
  private readonly staleTimeoutMs: number;
  private readonly aircraftByIcao = new Map<number, TrafficAircraft>();

  constructor(options: TrafficStoreOptions = {}) {
    this.nowFn = options.now ?? Date.now;
    this.staleTimeoutMs = options.staleTimeoutMs ?? DEFAULT_TRAFFIC_STALE_TIMEOUT_MS;
  }

  /** The store's current time source, exposed for integration helpers/tests. */
  now(): number {
    return this.nowFn();
  }

  /** Remove all traffic entries. */
  clear(): void {
    this.aircraftByIcao.clear();
  }

  /** Current number of non-stale entries. */
  size(atMs: number = this.now()): number {
    this.evictStale(atMs);
    return this.aircraftByIcao.size;
  }

  /** Return one aircraft by ICAO address after applying stale eviction. */
  get(icaoAddress: number, atMs: number = this.now()): TrafficAircraft | undefined {
    this.evictStale(atMs);
    return this.aircraftByIcao.get(icaoAddress);
  }

  /** Return all non-stale aircraft, sorted by ICAO address for stable rendering/tests. */
  all(atMs: number = this.now()): TrafficAircraft[] {
    this.evictStale(atMs);
    return [...this.aircraftByIcao.values()].sort((a, b) => a.icaoAddress - b.icaoAddress);
  }

  /** Ingest a decoded MAVLink `ADSB_VEHICLE` frame, replacing any prior same-ICAO entry. */
  ingestMessage(
    msg: DecodedMessage,
    receivedAtMs: number = this.now(),
  ): TrafficAircraft | undefined {
    const aircraft = parseAdsbVehicleMessage(msg, receivedAtMs);
    if (!aircraft) return undefined;
    this.aircraftByIcao.set(aircraft.icaoAddress, aircraft);
    this.evictStale(receivedAtMs);
    return this.aircraftByIcao.has(aircraft.icaoAddress) ? aircraft : undefined;
  }

  /** Drop stale entries and return how many were removed. */
  evictStale(atMs: number = this.now()): number {
    let removed = 0;
    for (const [icao, aircraft] of this.aircraftByIcao.entries()) {
      if (atMs - aircraft.lastSeenMs > this.staleTimeoutMs) {
        this.aircraftByIcao.delete(icao);
        removed += 1;
      }
    }
    return removed;
  }
}

/** Wire a MAVLink host-style decoded-message tap into a {@link TrafficStore}. */
export function connectTrafficStore(
  source: AdsbMessageSource,
  store: TrafficStore,
  options: TrafficStoreTapOptions = {},
): () => void {
  const now = options.now;
  return source.onMessage(['ADSB_VEHICLE'], (msg: DecodedMessage): void => {
    if (now) store.ingestMessage(msg, now());
    else store.ingestMessage(msg);
  });
}

/** Parse and normalize one MAVLink `ADSB_VEHICLE` frame. Invalid coordinates are ignored. */
export function parseAdsbVehicleMessage(
  msg: DecodedMessage,
  receivedAtMs: number,
): TrafficAircraft | undefined {
  if (msg.name !== 'ADSB_VEHICLE' || msg.msgId !== 246) return undefined;
  const fields = msg.fields;
  const icaoAddress = fieldInteger(fields, 'ICAO_address');
  const latRaw = fieldNumber(fields, 'lat');
  const lonRaw = fieldNumber(fields, 'lon');
  const altitudeRaw = fieldNumber(fields, 'altitude');
  const headingRaw = fieldNumber(fields, 'heading');
  const horizontalVelocityRaw = fieldNumber(fields, 'hor_velocity');
  if (
    icaoAddress === undefined ||
    latRaw === undefined ||
    lonRaw === undefined ||
    altitudeRaw === undefined ||
    headingRaw === undefined ||
    horizontalVelocityRaw === undefined
  ) {
    return undefined;
  }

  const lat = latRaw / 10_000_000;
  const lon = lonRaw / 10_000_000;
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return undefined;
  }

  const tslcSec = Math.max(0, fieldNumber(fields, 'tslc') ?? 0);
  return {
    icaoAddress,
    icaoHex: formatIcaoAddress(icaoAddress),
    lat,
    lon,
    altitudeM: altitudeRaw / 1000,
    headingDeg: normalizeHeading(headingRaw / 100),
    horizontalVelocityMps: horizontalVelocityRaw / 100,
    callsign: decodeCallsign(fields.callsign),
    emitterType: fieldInteger(fields, 'emitter_type') ?? 0,
    tslcSec,
    flags: fieldInteger(fields, 'flags') ?? 0,
    receivedAtMs,
    lastSeenMs: receivedAtMs - tslcSec * 1000,
  };
}

/** Format a numeric ICAO address as an uppercase hexadecimal display label. */
export function formatIcaoAddress(icaoAddress: number): string {
  const hex = Math.max(0, Math.trunc(icaoAddress)).toString(16).toUpperCase();
  return hex.padStart(Math.max(6, hex.length), '0');
}

function normalizeHeading(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

function fieldNumber(fields: Record<string, FieldValue>, key: string): number | undefined {
  const value = fields[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') {
    const n = Number(value);
    return Number.isSafeInteger(n) ? n : undefined;
  }
  return undefined;
}

function fieldInteger(fields: Record<string, FieldValue>, key: string): number | undefined {
  const value = fieldNumber(fields, key);
  if (value === undefined || !Number.isInteger(value) || value < 0) return undefined;
  return value;
}

function decodeCallsign(value: FieldValue | undefined): string {
  if (typeof value === 'string') return cleanCallsign(value);
  if (Array.isArray(value)) {
    return cleanCallsign(String.fromCharCode(...value.filter((n) => n > 0)));
  }
  return '';
}

function cleanCallsign(value: string): string {
  return value.replaceAll('\u0000', '').trim();
}
