/**
 * `transport/webrtc` public surface (T8.4; spec plan/03 §3.5 item 5). The
 * WebRTC DataChannel {@link Transport}/{@link TransportFactory} for low-latency
 * remote MAVLink byte streams. Signaling is injected through the open config so
 * applications can plug in their own signaling server/protocol.
 */
export {
  WebRtcTransport,
  createWebRtcTransportFactory,
  webRtcTransportFactory,
  webrtcTransportFactory,
  WEBRTC_CONFIG_SCHEMA,
} from './webrtc-transport';
export type {
  WebRtcConfig,
  WebRtcDataChannelConfig,
  WebRtcDataChannelLike,
  WebRtcDataChannelMessageEventLike,
  WebRtcIceCandidateEventLike,
  WebRtcIceCandidateLike,
  WebRtcPeerConnectionFactory,
  WebRtcPeerConnectionLike,
  WebRtcSignalingAnswer,
  WebRtcSignalingClient,
  WebRtcSignalingOffer,
  WebRtcTransportOptions,
} from './webrtc-transport';
