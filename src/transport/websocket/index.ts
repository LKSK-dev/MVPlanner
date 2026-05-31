/**
 * `transport/websocket` public surface (T1.7; spec plan/03 §3.5 item 4). The
 * WebSocket-bridge {@link Transport}/{@link TransportFactory} connecting the
 * browser to a `ws://`/`wss://` MAVLink proxy (SITL, `mavlink-router`, the
 * companion bridge). See {@link createWebSocketTransportFactory} for the
 * injectable factory used in tests and {@link websocketTransportFactory} for the
 * production default.
 */
export {
  WebSocketTransport,
  createWebSocketTransportFactory,
  websocketTransportFactory,
  WEBSOCKET_CONFIG_SCHEMA,
} from './websocket-transport';
export type {
  WebSocketConfig,
  WebSocketCtor,
  WebSocketLike,
  WebSocketMessageEventLike,
  WebSocketCloseEventLike,
  WebSocketTransportOptions,
  Scheduler,
} from './websocket-transport';
