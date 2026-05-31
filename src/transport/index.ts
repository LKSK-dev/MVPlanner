/**
 * Transport barrel. Each transport lives in its own subfolder behind the frozen
 * `Transport`/`TransportFactory` contract (`src/contracts/transport.ts`). The
 * connection manager (T1.10) consumes the factories from here.
 *
 * Note: per-module internal testing seams (each module's own `Scheduler` type)
 * are intentionally NOT re-exported at this top level to avoid name collisions;
 * import those from the specific subfolder if needed.
 */

// Re-export the contract types once for convenience.
export type { Transport, TransportFactory, ConnState, LinkStats } from '../contracts';

// Serial (T1.6)
export {
  SerialTransport,
  createSerialTransportFactory,
  serialTransportFactory,
  SERIAL_CONFIG_SCHEMA,
} from './serial';
export type { SerialTransportConfig } from './serial';

// WebSocket bridge (T1.7)
export {
  WebSocketTransport,
  createWebSocketTransportFactory,
  websocketTransportFactory,
  WEBSOCKET_CONFIG_SCHEMA,
} from './websocket';
export type { WebSocketConfig } from './websocket';

// Replay / tlog (T1.8)
export { ReplayTransport, replayTransportFactory, parseTlog, TlogParseError } from './replay';
export type { ReplayConfig, TlogFrame } from './replay';

import { serialTransportFactory } from './serial';
import { websocketTransportFactory } from './websocket';
import { replayTransportFactory } from './replay';
import type { TransportFactory } from '../contracts';

/** All built-in transport factories, keyed by id (for the connection manager). */
export const BUILTIN_TRANSPORT_FACTORIES: readonly TransportFactory[] = [
  serialTransportFactory,
  websocketTransportFactory,
  replayTransportFactory,
];
