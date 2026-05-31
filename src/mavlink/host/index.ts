/**
 * MAVLink worker-host public surface (task T1.9; spec plan/02 §2.1/§2.6).
 *
 * Two layers:
 *  - {@link MavlinkSession} — the pure, DOM/Worker-free core (parse → registry +
 *    vehicle model → coalesced snapshots, plus outgoing-frame encoding). Import
 *    this directly for unit tests; it needs no browser.
 *  - {@link MavlinkHost} — the main-thread client that owns the transport, relays
 *    bytes to/from the inlined worker, and fans out telemetry. Importing it pulls
 *    in the `?worker&inline` worker bundle, so consumers that only need the core
 *    should import {@link MavlinkSession} from `./session`.
 *
 * @see ./README.md for the contract, owned files, and how to test.
 */
export { MavlinkSession } from './session';
export type {
  MavlinkSessionOptions,
  TelemetrySnapshot,
  RateEntry,
  InspectorSnapshot,
  InspectorRow,
  RawFrame,
} from './session';

export { MavlinkHost } from './host';
export type {
  MavlinkHostOptions,
  StateListener,
  TelemetryListener,
  InspectorListener,
  MessageListener,
  RawFrameListener,
} from './host';

export {
  RPC_CONFIGURE,
  RPC_INGEST_BYTES,
  RPC_SEND_MESSAGE,
  RPC_RESET,
  RPC_TELEMETRY,
  RPC_INSPECTOR,
  RPC_MESSAGES,
  RPC_RAW_FRAMES,
  RPC_OUTGOING,
} from './protocol';
export type {
  ConfigureRequest,
  IngestBytesRequest,
  SendMessageRequest,
  TelemetryRequest,
  InspectorRequest,
  MessagesRequest,
  RawFramesRequest,
  OutgoingRequest,
} from './protocol';
