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

/** {@link RPC_OUTGOING} request — desired GCS heartbeat cadence in Hz (optional). */
export interface OutgoingRequest {
  heartbeatHz?: number;
}
