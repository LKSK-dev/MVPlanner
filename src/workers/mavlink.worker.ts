/**
 * MAVLink worker entry (task T1.9; spec plan/02 §2.1/§2.6). A THIN shim: it
 * binds an {@link import('../core/bus').Rpc} to the worker global scope and wires
 * it to a single {@link MavlinkSession}. All heavy work (parse + registry +
 * vehicle model + coalescing) lives in the pure session core, so this file holds
 * no logic of its own and stays free of DOM APIs.
 *
 * Threading model: the MAIN thread owns the transport (Web Serial etc. are
 * main-thread APIs) and acts as a byte relay — it streams inbound chunks here via
 * {@link RPC_INGEST_BYTES} and writes our outgoing frames (heartbeat + sends)
 * from the {@link RPC_OUTGOING} stream back to `transport.writable`. Nothing in
 * this worker touches device I/O.
 */
import type { MessageEndpoint } from '../core/bus';
import type { DecodedMessage, SigningConfig } from '../contracts';
import {
  MavlinkSession,
  type InspectorSnapshot,
  type RawFrame,
  type TelemetrySnapshot,
} from '../mavlink/host/session';
import {
  RPC_CONFIGURE,
  RPC_INGEST_BYTES,
  RPC_INSPECTOR,
  RPC_MESSAGES,
  RPC_OUTGOING,
  RPC_RAW_FRAMES,
  RPC_RESET,
  RPC_SEND_MESSAGE,
  RPC_TELEMETRY,
  type ConfigureRequest,
  type IngestBytesRequest,
  type InspectorRequest,
  type MessagesRequest,
  type OutgoingRequest,
  type RawFramesRequest,
  type SendMessageRequest,
  type TelemetryRequest,
} from '../mavlink/host/protocol';
import { serveWorker } from './rpc';

/** Default coalesced-telemetry cadence (Hz) — UI-friendly, well under packet rate. */
const DEFAULT_TELEMETRY_HZ = 25;
/** Default ON-DEMAND inspector cadence (Hz) per task T1.12 (~5–8 Hz). */
const DEFAULT_INSPECTOR_HZ = 6;
/** Default GCS heartbeat cadence (Hz) per spec plan/03 §3.3. */
const DEFAULT_HEARTBEAT_HZ = 1;

// Audited Worker boundary (impl 00 §0.3): the worker global carries far more
// than the RPC needs, so narrow it to the structural endpoint shape via
// `unknown`. The only thing we use is postMessage/onmessage.
const scope = self as unknown as MessageEndpoint;

const session = new MavlinkSession();
const rpc = serveWorker(scope);

/** Active outgoing-frame sink, set while the host subscribes {@link RPC_OUTGOING}. */
let outgoingSend: ((frame: Uint8Array) => void) | null = null;

rpc.handle<ConfigureRequest, void>(RPC_CONFIGURE, (req) => {
  if (req.signing !== undefined) {
    const cfg: SigningConfig | undefined = req.signing ?? undefined;
    session.setSigning(cfg);
  }
  return Promise.resolve();
});

rpc.handle<IngestBytesRequest, void>(RPC_INGEST_BYTES, (bytes) => {
  session.pushBytes(bytes);
  return Promise.resolve();
});

rpc.handle<SendMessageRequest, void>(RPC_SEND_MESSAGE, (req) => {
  const frame = session.encodeMessage(req.name, req.fields);
  outgoingSend?.(frame);
  return Promise.resolve();
});

rpc.handle<void, void>(RPC_RESET, () => {
  session.reset();
  return Promise.resolve();
});

rpc.handleStream<TelemetryRequest, TelemetrySnapshot>(RPC_TELEMETRY, (req, send, signal) => {
  const hz = req.hz !== undefined && req.hz > 0 ? req.hz : DEFAULT_TELEMETRY_HZ;
  const periodMs = Math.max(1, Math.round(1000 / hz));
  let lastRev = -1;
  return new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const snap = session.takeSnapshot();
      if (snap.rev === lastRev) return; // coalesce: only emit on change
      lastRev = snap.rev;
      send(snap);
    }, periodMs);
    const stop = (): void => {
      clearInterval(timer);
      resolve();
    };
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
});

rpc.handleStream<InspectorRequest, InspectorSnapshot>(RPC_INSPECTOR, (req, send, signal) => {
  // On-demand only: the full inspector table is built and emitted ONLY while
  // this stream is subscribed (task T1.12). The interval is torn down on cancel.
  const hz = req.hz !== undefined && req.hz > 0 ? req.hz : DEFAULT_INSPECTOR_HZ;
  const periodMs = Math.max(1, Math.round(1000 / hz));
  let lastRev = -1;
  return new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      const snap = session.takeInspectorSnapshot();
      if (snap.rev === lastRev) return; // coalesce: only emit on change
      lastRev = snap.rev;
      send(snap);
    }, periodMs);
    const stop = (): void => {
      clearInterval(timer);
      resolve();
    };
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
});

rpc.handleStream<MessagesRequest, DecodedMessage>(RPC_MESSAGES, (req, send, signal) => {
  // Selective decoded-message tap: forward only messages whose name is in
  // `req.names`. Filtering lives in the pure session; this handler just bridges
  // the session tap to the RPC stream and disposes it on cancel. Each subscriber
  // gets its own session tap (multiplex), so concurrent streams do not interfere.
  return new Promise<void>((resolve) => {
    const dispose = session.onMessage(req.names, (msg) => send(msg));
    const stop = (): void => {
      dispose();
      resolve();
    };
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
});

rpc.handleStream<RawFramesRequest, RawFrame>(RPC_RAW_FRAMES, (_req, send, signal) => {
  // Raw-frame tap: forward EVERY parsed frame for tlog recording (never dropped).
  // The session tap runs only while subscribed; cancelling disposes it.
  return new Promise<void>((resolve) => {
    const dispose = session.onRawFrame((frame) => send(frame));
    const stop = (): void => {
      dispose();
      resolve();
    };
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
});

rpc.handleStream<OutgoingRequest, Uint8Array>(RPC_OUTGOING, (req, send, signal) => {
  const hz =
    req.heartbeatHz !== undefined && req.heartbeatHz > 0 ? req.heartbeatHz : DEFAULT_HEARTBEAT_HZ;
  const periodMs = Math.max(1, Math.round(1000 / hz));
  outgoingSend = send;
  return new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      send(session.encodeHeartbeat());
    }, periodMs);
    const stop = (): void => {
      clearInterval(timer);
      if (outgoingSend === send) outgoingSend = null;
      resolve();
    };
    if (signal.aborted) stop();
    else signal.addEventListener('abort', stop, { once: true });
  });
});
