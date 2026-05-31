/**
 * {@link StreamRateService} — asks the vehicle to emit the MAVLink messages the
 * GCS needs, at modest rates (task T1.11; spec plan/03 §3.3 "Stream/rate
 * management", §3.4 "Heartbeat").
 *
 * Primary mechanism: `MAV_CMD_SET_MESSAGE_INTERVAL` (command 511) carried in a
 * `COMMAND_LONG`, where `param1` is the message id and `param2` is the desired
 * interval in **microseconds** (`1e6 / hz`; `0` requests the firmware default,
 * `-1` disables the message). For older firmware that predates per-message
 * intervals there is a `REQUEST_DATA_STREAM` (msg id 66) fallback that requests
 * whole *stream groups* at a Hz rate.
 *
 * The service is pure logic: it takes an injected `send(name, fields)` function
 * (bound by the caller to e.g. the worker host's `sendMessage`) so it never
 * imports the worker/host and stays unit-testable. Message ids, the
 * `MAV_CMD_SET_MESSAGE_INTERVAL` value, and the `MAV_DATA_STREAM` ids are
 * resolved from a {@link DialectTable} (the bundled `common` dialect by default)
 * rather than hard-coded magic numbers.
 *
 * Adaptive-by-visible-UI throttling and hidden-tab back-off (spec plan/03 §3.3)
 * are a documented future refinement and are intentionally NOT implemented for
 * M1; this service provides the default-set request on connect plus the
 * per-message rate / disable API.
 */
import type { DialectTable } from '../../../contracts';
import { commonDialect } from '../../dialects';

/**
 * The message-send primitive the service depends on. Bound by the caller to the
 * active link's encode+send path (e.g. the worker host's `sendMessage`). May be
 * synchronous or return a promise; the service awaits it either way.
 */
export type StreamSendFn = (name: string, fields: Record<string, unknown>) => void | Promise<void>;

/** Construction options for {@link StreamRateService}. */
export interface StreamRateServiceOptions {
  /** Encode + send a message out the active link. */
  readonly send: StreamSendFn;
  /** Target vehicle system id (default `1`). */
  readonly targetSystem?: number;
  /** Target autopilot component id (default `1`). */
  readonly targetComponent?: number;
  /**
   * When `true`, {@link StreamRateService.requestDefaultSet} uses the legacy
   * `REQUEST_DATA_STREAM` path instead of `SET_MESSAGE_INTERVAL` — for firmware
   * that predates per-message intervals.
   */
  readonly useLegacyDataStream?: boolean;
  /** Dialect used to resolve message / command / stream ids (default `common`). */
  readonly dialect?: DialectTable;
}

/** `MAV_CMD_SET_MESSAGE_INTERVAL` — fallback value if absent from the dialect. */
const SET_MESSAGE_INTERVAL_CMD = 511;
/** `param2` sentinel: request the firmware's default interval for the message. */
const INTERVAL_DEFAULT_US = 0;
/** `param2` sentinel: stop the firmware from emitting the message. */
const INTERVAL_DISABLE_US = -1;
/** Modest default rate for the live-ops message set (Hz). */
const DEFAULT_RATE_HZ = 4;

/**
 * The default live-ops message set requested on connect — enough to drive the
 * HUD / map / instruments at a modest rate without saturating a low-bandwidth
 * radio link. `HEARTBEAT` is vehicle-driven and is deliberately omitted.
 */
const DEFAULT_MESSAGE_NAMES: readonly string[] = [
  'SYS_STATUS',
  'ATTITUDE',
  'GLOBAL_POSITION_INT',
  'GPS_RAW_INT',
  'VFR_HUD',
  'RC_CHANNELS',
  'BATTERY_STATUS',
  'MISSION_CURRENT',
];

/**
 * The default legacy stream groups (and rate) requested on connect when
 * `useLegacyDataStream` is set. These groups collectively cover the same
 * telemetry as {@link DEFAULT_MESSAGE_NAMES} on ArduPilot/PX4-era firmware.
 */
const DEFAULT_LEGACY_STREAMS: readonly string[] = [
  'MAV_DATA_STREAM_EXTENDED_STATUS', // SYS_STATUS, GPS_RAW_INT, MISSION_CURRENT
  'MAV_DATA_STREAM_POSITION', // GLOBAL_POSITION_INT
  'MAV_DATA_STREAM_EXTRA1', // ATTITUDE
  'MAV_DATA_STREAM_EXTRA2', // VFR_HUD
  'MAV_DATA_STREAM_RC_CHANNELS', // RC_CHANNELS
];

/** Build a `messageName -> id` lookup from a dialect's message table. */
function buildNameToId(dialect: DialectTable): ReadonlyMap<string, number> {
  const map = new Map<string, number>();
  for (const meta of Object.values(dialect.messages)) {
    map.set(meta.name, meta.id);
  }
  return map;
}

/** Resolve an enum entry value by name, or `undefined` when absent. */
function enumValue(dialect: DialectTable, enumName: string, entryName: string): number | undefined {
  const entries = dialect.enums[enumName];
  if (entries === undefined) return undefined;
  return entries.find((e) => e.name === entryName)?.value;
}

/**
 * Requests vehicle telemetry stream rates. See the file header for the contract.
 */
export class StreamRateService {
  private readonly send: StreamSendFn;
  private readonly targetSystem: number;
  private readonly targetComponent: number;
  private readonly useLegacyDataStream: boolean;
  private readonly nameToId: ReadonlyMap<string, number>;
  private readonly dialect: DialectTable;
  private readonly setMessageIntervalCmd: number;

  constructor(options: StreamRateServiceOptions) {
    this.send = options.send;
    this.targetSystem = options.targetSystem ?? 1;
    this.targetComponent = options.targetComponent ?? 1;
    this.useLegacyDataStream = options.useLegacyDataStream ?? false;
    this.dialect = options.dialect ?? commonDialect;
    this.nameToId = buildNameToId(this.dialect);
    this.setMessageIntervalCmd =
      enumValue(this.dialect, 'MAV_CMD', 'MAV_CMD_SET_MESSAGE_INTERVAL') ??
      SET_MESSAGE_INTERVAL_CMD;
  }

  /**
   * Request `msgId` at `hz` via `MAV_CMD_SET_MESSAGE_INTERVAL`. `hz > 0` maps to
   * an interval of `round(1e6 / hz)` microseconds; `hz === 0` requests the
   * firmware default interval. To stop a message use {@link disableMessage}.
   */
  async setMessageRate(msgId: number, hz: number): Promise<void> {
    const intervalUs = hz > 0 ? Math.round(1_000_000 / hz) : INTERVAL_DEFAULT_US;
    await this.sendSetMessageInterval(msgId, intervalUs);
  }

  /** Stop the vehicle from emitting `msgId` (`SET_MESSAGE_INTERVAL` with `-1`). */
  async disableMessage(msgId: number): Promise<void> {
    await this.sendSetMessageInterval(msgId, INTERVAL_DISABLE_US);
  }

  /**
   * Request a legacy stream group via `REQUEST_DATA_STREAM`. `streamId` is a
   * `MAV_DATA_STREAM` value; `start` toggles `start_stop` (default `true`).
   */
  async requestDataStream(streamId: number, hz: number, start = true): Promise<void> {
    await Promise.resolve(
      this.send('REQUEST_DATA_STREAM', {
        target_system: this.targetSystem,
        target_component: this.targetComponent,
        req_stream_id: streamId,
        req_message_rate: Math.max(0, Math.round(hz)),
        start_stop: start ? 1 : 0,
      }),
    );
  }

  /**
   * Request a sensible default set of live-ops messages at a modest rate. Uses
   * `SET_MESSAGE_INTERVAL` per message by default, or the `REQUEST_DATA_STREAM`
   * group fallback when constructed with `useLegacyDataStream`. Resolves once
   * every request has been handed to the injected `send`.
   */
  async requestDefaultSet(): Promise<void> {
    if (this.useLegacyDataStream) {
      await Promise.all(
        DEFAULT_LEGACY_STREAMS.map((name) =>
          this.requestDataStream(this.requireStreamId(name), DEFAULT_RATE_HZ),
        ),
      );
      return;
    }
    await Promise.all(
      DEFAULT_MESSAGE_NAMES.map((name) =>
        this.setMessageRate(this.requireMsgId(name), DEFAULT_RATE_HZ),
      ),
    );
  }

  /** Emit a `COMMAND_LONG` carrying `MAV_CMD_SET_MESSAGE_INTERVAL`. */
  private async sendSetMessageInterval(msgId: number, intervalUs: number): Promise<void> {
    await Promise.resolve(
      this.send('COMMAND_LONG', {
        command: this.setMessageIntervalCmd,
        param1: msgId,
        param2: intervalUs,
        param3: 0,
        param4: 0,
        param5: 0,
        param6: 0,
        param7: 0,
        target_system: this.targetSystem,
        target_component: this.targetComponent,
        confirmation: 0,
      }),
    );
  }

  /** Resolve a message id by name, throwing with context when the dialect lacks it. */
  private requireMsgId(name: string): number {
    const id = this.nameToId.get(name);
    if (id === undefined) {
      throw new Error(
        `StreamRateService: message "${name}" not found in dialect "${this.dialect.name}"`,
      );
    }
    return id;
  }

  /** Resolve a `MAV_DATA_STREAM` id by name, throwing with context when absent. */
  private requireStreamId(name: string): number {
    const id = enumValue(this.dialect, 'MAV_DATA_STREAM', name);
    if (id === undefined) {
      throw new Error(
        `StreamRateService: stream "${name}" not found in dialect "${this.dialect.name}"`,
      );
    }
    return id;
  }
}

/** Construct a {@link StreamRateService} (ergonomic factory). */
export function createStreamRateService(options: StreamRateServiceOptions): StreamRateService {
  return new StreamRateService(options);
}
