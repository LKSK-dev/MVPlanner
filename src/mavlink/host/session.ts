/**
 * {@link MavlinkSession} — the pure, DOM/Worker-free core of the MAVLink worker
 * host (task T1.9; spec plan/02 §2.1/§2.6).
 *
 * It owns no I/O. It wires the streaming codec parser into the
 * {@link MessageRegistry} (rates / loss / inspector) and the {@link VehicleModel}
 * (derived per-vehicle state), and produces COALESCED telemetry snapshots for
 * the UI. It also encodes outgoing GCS frames (a 1 Hz HEARTBEAT and arbitrary
 * messages) on a single, auto-incrementing transmit sequence.
 *
 * Because it depends only on the codec / registry / vehicle-model modules and an
 * injectable clock, it is fully unit-testable without a browser, a Worker, or a
 * transport: feed it real encoded frames via {@link MavlinkSession.pushBytes}
 * and read {@link MavlinkSession.takeSnapshot}.
 *
 * Memory is bounded: the registry caps its per-stream ring buffers and rate
 * samples, the vehicle model keeps one record per `(sysid, compid)`, and the
 * session itself holds only small scalar counters.
 */
import type {
  DecodedMessage,
  DialectTable,
  FieldValue,
  LinkStats,
  MessageInput,
  SigningConfig,
  VehicleState,
} from '../../contracts';
import { type Codec, createMavCodec } from '../codec';
import { BUILTIN_DIALECTS } from '../dialects';
import { MessageRegistry, createDialectResolver } from '../registry';
import type { MavParser } from '../../contracts';
import { VehicleModel } from '../../vehicle';

/** `MAV_TYPE_GCS` — this station identifies as a ground control station. */
const MAV_TYPE_GCS = 6;
/** `MAV_AUTOPILOT_INVALID` — a GCS has no autopilot. */
const MAV_AUTOPILOT_INVALID = 8;
/** `MAV_STATE_ACTIVE` — the GCS heartbeat advertises an active station. */
const MAV_STATE_ACTIVE = 4;
/** MAVLink wire-format version advertised in our HEARTBEAT. */
const MAVLINK_VERSION = 3;

/** Default GCS source identity (`MAV_COMP_ID_MISSIONPLANNER` style address). */
const DEFAULT_GCS_SYSID = 255;
const DEFAULT_GCS_COMPID = 190;

/**
 * Lightweight inspector rate/last-seen row for one `(sysid, compid, msgId)`
 * stream. This is the heavy-ring-free projection the UI needs at telemetry
 * cadence (the full {@link import('../registry').MessageRecord} with its frame
 * ring stays in the registry for on-demand inspector queries).
 */
export interface RateEntry {
  sysid: number;
  compid: number;
  msgId: number;
  name: string;
  /** Observed rate in Hz over the registry's sliding window. */
  rateHz: number;
  /** Last-seen timestamp in the session clock domain (ms). */
  lastSeenMs: number;
  /** Total messages ingested for this stream. */
  count: number;
}

/**
 * A coalesced telemetry snapshot. Produced on demand (or at a fixed cadence by
 * the worker) and structurally cloned to the UI thread.
 *
 * `vehicles[].link` is filled from the registry's rate/loss accounting; the
 * byte/rssi/signed counters are left at their zero/false defaults for the
 * main-thread host to overlay from `transport.stats()` (it owns the wire).
 */
export interface TelemetrySnapshot {
  /** Derived state for every known vehicle, sorted by `(sysid, compid)`. */
  vehicles: VehicleState[];
  /** Inspector rate/last-seen table, sorted by `(sysid, compid, msgId)`. */
  rates: RateEntry[];
  /** The most-recently-heard vehicle's `sysid`, if any vehicle is known. */
  activeSysid?: number;
  /** Monotonic revision; bumps whenever ingested traffic changes state. */
  rev: number;
}

/**
 * A full inspector row for one `(sysid, compid, msgId)` stream — the heavy
 * projection the MAVLink inspector (task T1.12; spec plan/04 §4.9) needs but
 * the always-on {@link TelemetrySnapshot} deliberately omits to stay light.
 *
 * It carries everything to render the message/field tree, observed rate,
 * last-seen, the latest decoded field values (enum decoding is the UI's job via
 * dialect metadata), the latest raw frame bytes (for the hex view) and the
 * frame's signing / CRC status. Built ON DEMAND from the {@link MessageRegistry}
 * and only while the inspector stream is subscribed.
 */
export interface InspectorRow {
  sysid: number;
  compid: number;
  msgId: number;
  name: string;
  /** Observed rate in Hz over the registry's sliding window. */
  rateHz: number;
  /** Last-seen timestamp in the session clock domain (ms). */
  lastSeenMs: number;
  /** Total messages ingested for this stream. */
  count: number;
  /** Latest decoded field values (verbatim MAVLink field names). */
  fields: Record<string, FieldValue>;
  /** Raw bytes of the latest frame (for the hex view). */
  raw: Uint8Array;
  /** Whether the latest frame's CRC validated. */
  crcOk: boolean;
  /** Whether the latest frame was signed (MAVLink v2). */
  signed: boolean;
  /** Signing link id of the latest frame, when signed. */
  linkId?: number;
  /** Sequence number of the latest frame. */
  seq: number;
  /** Receive time (us) of the latest frame. */
  rxTimeUs: number;
}

/**
 * The full inspector table: one {@link InspectorRow} per observed
 * `(sysid, compid, msgId)` stream, sorted by `(sysid, compid, msgId)`. Produced
 * on demand by {@link MavlinkSession.takeInspectorSnapshot} and structurally
 * cloned to the UI thread by the worker's `inspector` stream.
 */
export interface InspectorSnapshot {
  /** Every observed stream, sorted by `(sysid, compid, msgId)`. */
  rows: InspectorRow[];
  /** Monotonic revision; mirrors {@link TelemetrySnapshot.rev} for coalescing. */
  rev: number;
}

/** Construction options for {@link MavlinkSession}. */
export interface MavlinkSessionOptions {
  /** Dialect tables for parse + encode (default {@link BUILTIN_DIALECTS}). */
  dialects?: readonly DialectTable[];
  /** Initial v2 signing configuration (sign outgoing, verify incoming). */
  signing?: SigningConfig;
  /** Injectable clock (ms) for ingest timestamps; default `Date.now`. */
  nowMs?: () => number;
  /** Outgoing frame version; MAVLink 2 (default) is required for signing. */
  version?: 1 | 2;
  /** GCS source identity for outgoing frames (default 255/190). */
  gcsSysid?: number;
  gcsCompid?: number;
}

/** A fresh zeroed {@link LinkStats}; byte/rssi/signed fields the host overlays. */
function zeroLink(): LinkStats {
  return { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false };
}

/**
 * Pure MAVLink session: parse → registry + vehicle model → coalesced snapshots,
 * plus outgoing-frame encoding. No DOM, no Worker, no transport.
 */
export class MavlinkSession {
  private readonly dialects: readonly DialectTable[];
  private readonly codec: Codec;
  private readonly registry: MessageRegistry;
  private readonly vehicles: VehicleModel;
  private readonly clock: () => number;
  private readonly version: 1 | 2;
  private readonly gcsSysid: number;
  private readonly gcsCompid: number;

  private parser: MavParser;
  private signing: SigningConfig | undefined;
  /** Single transmit sequence shared by every outgoing frame (wraps at 256). */
  private txSeq = 0;
  /** Monotonic snapshot revision; bumps when ingested traffic changes state. */
  private rev = 0;
  /** `sysid` of the most recently heard HEARTBEAT, or `undefined`. */
  private activeSysid: number | undefined;

  constructor(options: MavlinkSessionOptions = {}) {
    this.dialects = options.dialects ?? BUILTIN_DIALECTS;
    this.clock = options.nowMs ?? ((): number => Date.now());
    this.version = options.version ?? 2;
    this.gcsSysid = options.gcsSysid ?? DEFAULT_GCS_SYSID;
    this.gcsCompid = options.gcsCompid ?? DEFAULT_GCS_COMPID;
    this.signing = options.signing;

    this.codec = createMavCodec({ dialects: this.dialects });
    this.registry = new MessageRegistry({
      resolver: createDialectResolver(this.dialects),
      clock: this.clock,
    });
    this.vehicles = new VehicleModel({ clock: this.clock });
    this.parser = this.makeParser();
  }

  /**
   * Feed raw bytes to the streaming parser and ingest every decoded message into
   * the registry and vehicle model. Returns the messages decoded from this chunk
   * (resync-safe; a partial frame is buffered until completed). Each decode bumps
   * the snapshot revision so the host can coalesce/skip unchanged emits.
   */
  pushBytes(bytes: Uint8Array): DecodedMessage[] {
    const now = this.clock();
    const msgs = this.parser.push(bytes);
    for (const msg of msgs) {
      this.registry.ingest(msg, now);
      this.vehicles.ingest(msg, now);
      if (msg.name === 'HEARTBEAT') this.activeSysid = msg.sysid;
    }
    if (msgs.length > 0) this.rev += 1;
    return msgs;
  }

  /**
   * Build a coalesced snapshot of current vehicle + rate state. The returned
   * objects are private copies (the registry/model snapshot methods clone), so
   * the caller may retain or transfer them freely.
   */
  takeSnapshot(): TelemetrySnapshot {
    const records = this.registry.snapshot();
    const rates: RateEntry[] = [];
    const linkRateHz = new Map<string, number>();
    for (const r of records) {
      rates.push({
        sysid: r.sysid,
        compid: r.compid,
        msgId: r.msgId,
        name: r.name,
        rateHz: r.rateHz,
        lastSeenMs: r.lastSeenMs,
        count: r.count,
      });
      const key = `${r.sysid}:${r.compid}`;
      linkRateHz.set(key, (linkRateHz.get(key) ?? 0) + r.rateHz);
    }

    const vehicles = this.vehicles.snapshot();
    for (const v of vehicles) {
      const loss = this.registry.linkStats(v.sysid, v.compid);
      const link = zeroLink();
      link.packetsIn = loss?.received ?? 0;
      link.lossPct = loss?.lossPct ?? 0;
      link.rateHz = linkRateHz.get(`${v.sysid}:${v.compid}`) ?? 0;
      v.link = link;
    }

    const activeSysid = this.resolveActiveSysid(vehicles);
    return {
      vehicles,
      rates,
      ...(activeSysid !== undefined ? { activeSysid } : {}),
      rev: this.rev,
    };
  }

  /**
   * Build the FULL inspector table from the {@link MessageRegistry} (task T1.12;
   * spec plan/04 §4.9). Unlike {@link takeSnapshot}'s light `rates` projection,
   * each row carries the latest decoded fields, the latest raw frame bytes (for
   * the hex view) and the frame's signing / CRC status. The registry snapshot
   * clones its records, so the returned rows are private copies the caller may
   * retain or transfer.
   *
   * This is intentionally heavier than the always-on telemetry path; the worker
   * only calls it while the on-demand `inspector` stream is subscribed.
   */
  takeInspectorSnapshot(): InspectorSnapshot {
    const records = this.registry.snapshot();
    const rows: InspectorRow[] = records.map((r) => {
      const m = r.latest;
      return {
        sysid: r.sysid,
        compid: r.compid,
        msgId: r.msgId,
        name: r.name,
        rateHz: r.rateHz,
        lastSeenMs: r.lastSeenMs,
        count: r.count,
        fields: m.fields,
        raw: m.raw,
        crcOk: m.crcOk,
        signed: m.signed,
        seq: m.seq,
        rxTimeUs: m.rxTimeUs,
        ...(m.linkId !== undefined ? { linkId: m.linkId } : {}),
      };
    });
    return { rows, rev: this.rev };
  }

  /** Encode a GCS HEARTBEAT (GCS / INVALID / ACTIVE) on the next tx sequence. */
  encodeHeartbeat(): Uint8Array {
    return this.encode({
      name: 'HEARTBEAT',
      sysid: this.gcsSysid,
      compid: this.gcsCompid,
      fields: {
        type: MAV_TYPE_GCS,
        autopilot: MAV_AUTOPILOT_INVALID,
        base_mode: 0,
        custom_mode: 0,
        system_status: MAV_STATE_ACTIVE,
        mavlink_version: MAVLINK_VERSION,
      },
    });
  }

  /** Encode an arbitrary message by name from the GCS identity. */
  encodeMessage(name: string, fields: Record<string, unknown>): Uint8Array {
    return this.encode({ name, fields, sysid: this.gcsSysid, compid: this.gcsCompid });
  }

  /**
   * Replace the signing configuration (sign outgoing, verify incoming). Pass
   * `undefined` to disable. The streaming parser is rebuilt; any partially
   * buffered inbound frame is dropped (signing changes are config-time events).
   */
  setSigning(cfg: SigningConfig | undefined): void {
    this.signing = cfg;
    this.parser = this.makeParser();
  }

  /** Drop all accumulated registry + vehicle state (e.g. on reconnect). */
  reset(): void {
    this.registry.clear();
    this.vehicles.clear();
    this.parser.reset();
    this.activeSysid = undefined;
    this.rev += 1;
  }

  private makeParser(): MavParser {
    return this.codec.parser(
      this.signing
        ? { dialects: this.dialects, signing: this.signing }
        : { dialects: this.dialects },
    );
  }

  private encode(input: MessageInput): Uint8Array {
    const seq = this.txSeq;
    this.txSeq = (this.txSeq + 1) & 0xff;
    return this.codec.encode(
      input,
      this.signing
        ? { version: this.version, seq, signing: this.signing }
        : { version: this.version, seq },
    );
  }

  /** Pick the most-recently-heard vehicle, preferring the latest HEARTBEAT. */
  private resolveActiveSysid(vehicles: readonly VehicleState[]): number | undefined {
    if (vehicles.length === 0) return undefined;
    if (this.activeSysid !== undefined && vehicles.some((v) => v.sysid === this.activeSysid)) {
      return this.activeSysid;
    }
    let best = vehicles[0];
    if (best === undefined) return undefined;
    for (const v of vehicles) {
      if (v.lastHeartbeatMs > best.lastHeartbeatMs) best = v;
    }
    return best.sysid;
  }
}
