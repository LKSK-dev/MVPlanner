/**
 * The RPC wire contract between {@link import('./host').MavlinkHost} (main
 * thread) and `src/workers/mavlink.worker.ts` (T1.9). Method names and
 * request/response shapes live here so both sides stay in lock-step. Payloads
 * cross the `postMessage` boundary by structured clone (the frozen
 * `src/core/bus` RPC does not expose a transfer list — see host/README.md).
 */
import type { SigningConfig } from '../../contracts';

/** call: replace signing config (and other future runtime options). */
export const RPC_CONFIGURE = 'configure';
/** call: feed a raw inbound byte chunk to the session parser. */
export const RPC_INGEST_BYTES = 'ingestBytes';
/** call: encode + enqueue an outgoing message from the GCS identity. */
export const RPC_SEND_MESSAGE = 'sendMessage';
/** call: drop accumulated registry/vehicle state (e.g. on reconnect). */
export const RPC_RESET = 'reset';
/** stream: coalesced {@link import('./session').TelemetrySnapshot} at a cadence. */
export const RPC_TELEMETRY = 'telemetry';
/**
 * stream: ON-DEMAND full {@link import('./session').InspectorSnapshot} at a
 * modest cadence (~5–8 Hz), built from the registry ONLY while subscribed
 * (task T1.12; spec plan/04 §4.9). Heavier than {@link RPC_TELEMETRY}, so it is
 * deliberately separate and not part of the always-on telemetry path.
 */
export const RPC_INSPECTOR = 'inspector';
/**
 * stream: SELECTIVE decoded-message tap. Emits ONLY decoded messages whose
 * `name` is in the request's `names` set — the reply path for ACK/reply-driven
 * microservices (await `COMMAND_ACK`, `PARAM_VALUE`, `MISSION_*`; spec plan/03
 * §3.4). SEPARATE from {@link RPC_TELEMETRY}: it is not coalesced and carries
 * full {@link import('../../contracts').DecodedMessage}s. Each subscription is
 * its own stream with its own filter (multiplex); cancelling closes it.
 */
export const RPC_MESSAGES = 'messages';
/**
 * stream: RAW FRAME tap. Emits a lean {@link import('./session').RawFrame} for
 * EVERY parsed frame (for tlog recording, spec plan/07 §7.4, which must never
 * drop). SEPARATE from the coalesced telemetry path; runs only while subscribed.
 */
export const RPC_RAW_FRAMES = 'rawFrames';
/** stream: outgoing frame bytes the host writes to `transport.writable`. */
export const RPC_OUTGOING = 'outgoing';

/**
 * {@link RPC_CONFIGURE} request. `signing` semantics: omitted leaves the current
 * config unchanged; `null` disables signing; a value installs it.
 */
export interface ConfigureRequest {
  signing?: SigningConfig | null;
}

/** {@link RPC_INGEST_BYTES} request — one inbound chunk from the transport. */
export type IngestBytesRequest = Uint8Array;

/** {@link RPC_SEND_MESSAGE} request — message name + fields by MAVLink name. */
export interface SendMessageRequest {
  name: string;
  fields: Record<string, unknown>;
}

/** {@link RPC_TELEMETRY} request — desired snapshot cadence in Hz (optional). */
export interface TelemetryRequest {
  hz?: number;
}

/** {@link RPC_INSPECTOR} request — desired inspector cadence in Hz (optional). */
export interface InspectorRequest {
  hz?: number;
}

/**
 * {@link RPC_MESSAGES} request — the message names this subscription wants. Only
 * decoded messages whose `name` is in `names` are streamed back.
 */
export interface MessagesRequest {
  names: readonly string[];
}

/**
 * {@link RPC_RAW_FRAMES} request — no parameters; the raw tap streams every
 * parsed frame. Modelled as an empty object so the wire stays a plain record.
 */
export type RawFramesRequest = Record<string, never>;

/** {@link RPC_OUTGOING} request — desired GCS heartbeat cadence in Hz (optional). */
export interface OutgoingRequest {
  heartbeatHz?: number;
}
