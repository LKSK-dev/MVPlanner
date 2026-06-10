/**
 * WebRTC DataChannel transport (T8.4; spec plan/03 §3.5 item 5).
 *
 * This module implements the frozen {@link Transport} seam as a raw duplex byte
 * pipe over a browser WebRTC {@link RTCDataChannel}. Signaling is deliberately
 * injected by callers via {@link WebRtcConfig.signaling}; this transport never
 * hard-binds a signaling server or protocol. Tests inject a fake
 * {@link WebRtcPeerConnectionFactory}, fake signaling client, and fake data
 * channel so the offer/answer, ICE, and byte-stream behavior can be driven
 * deterministically without a browser network stack.
 */

import type { ConnState, LinkStats, Transport, TransportFactory } from '../../contracts';

/** Minimal message-event shape consumed from an RTCDataChannel. */
export interface WebRtcDataChannelMessageEventLike {
  readonly data: unknown;
}

/** Minimal serializable ICE candidate shape accepted from browser/fakes. */
export interface WebRtcIceCandidateLike {
  readonly candidate?: string;
  readonly sdpMid?: string | null;
  readonly sdpMLineIndex?: number | null;
  readonly usernameFragment?: string | null;
  toJSON?: () => RTCIceCandidateInit;
}

/** Minimal ICE-candidate event shape consumed from an RTCPeerConnection. */
export interface WebRtcIceCandidateEventLike {
  readonly candidate: WebRtcIceCandidateLike | null;
}

/** Structural view of the RTCDataChannel members this transport uses. */
export interface WebRtcDataChannelLike {
  /** Must be set to `'arraybuffer'` so binary frames arrive as ArrayBuffers. */
  binaryType: BinaryType;
  /** Browser channel readiness; sends are only attempted while this is `'open'`. */
  readonly readyState: RTCDataChannelState;
  onopen: (() => void) | null;
  onmessage: ((ev: WebRtcDataChannelMessageEventLike) => void) | null;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  send(data: ArrayBufferView): void;
  close(): void;
}

/** Structural view of the RTCPeerConnection members this transport uses. */
export interface WebRtcPeerConnectionLike {
  readonly connectionState?: RTCPeerConnectionState;
  readonly iceGatheringState?: RTCIceGatheringState;
  readonly localDescription?: RTCSessionDescriptionInit | null;
  onconnectionstatechange: (() => void) | null;
  onicegatheringstatechange: (() => void) | null;
  onicecandidate: ((ev: WebRtcIceCandidateEventLike) => void) | null;
  createDataChannel(label: string, options?: RTCDataChannelInit): WebRtcDataChannelLike;
  createOffer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  close(): void;
}

/** Injectable peer-connection factory for production support checks and tests. */
export type WebRtcPeerConnectionFactory = (
  configuration?: RTCConfiguration,
) => WebRtcPeerConnectionLike;

/** Offer request sent through the injected signaling seam. */
export interface WebRtcSignalingOffer {
  readonly offer: RTCSessionDescriptionInit;
  readonly iceCandidates: readonly RTCIceCandidateInit[];
}

/** Answer response returned by the injected signaling seam. */
export interface WebRtcSignalingAnswer {
  readonly answer: RTCSessionDescriptionInit;
  readonly iceCandidates?: readonly RTCIceCandidateInit[];
}

/** Pluggable signaling client; callers decide transport/server/protocol. */
export interface WebRtcSignalingClient {
  /** Exchange the local offer + gathered ICE candidates for a remote answer. */
  exchangeOffer(offer: WebRtcSignalingOffer): Promise<WebRtcSignalingAnswer>;
  /** Optional cleanup hook for long-poll/WebSocket/etc. signaling clients. */
  close?(): void | Promise<void>;
}

/** Optional data-channel tuning exposed through {@link WebRtcConfig}. */
export interface WebRtcDataChannelConfig {
  /** Channel label; defaults to `'mavlink'`. */
  readonly label?: string;
  /** Reliable ordered channel by default (`true`); pass `false` to opt out. */
  readonly ordered?: boolean;
  readonly maxPacketLifeTime?: number;
  readonly maxRetransmits?: number;
  readonly protocol?: string;
  readonly negotiated?: boolean;
  readonly id?: number;
}

/** Validated `open()` configuration. */
export interface WebRtcConfig {
  /** Injected signaling seam. No server is hard-coded in this transport. */
  readonly signaling: WebRtcSignalingClient;
  /** Optional native RTCPeerConnection configuration (ICE servers, policy, ...). */
  readonly rtcConfiguration?: RTCConfiguration;
  /** Optional DataChannel settings; reliable + ordered by default. */
  readonly dataChannel?: WebRtcDataChannelConfig;
  /** ICE gather wait before signaling; defaults to 1000 ms. */
  readonly iceGatheringTimeoutMs?: number;
}

/** Constructor/factory options for {@link WebRtcTransport}. */
export interface WebRtcTransportOptions {
  /** `RTCPeerConnection` factory; defaults to the browser global when present. */
  readonly peerConnectionFactory?: WebRtcPeerConnectionFactory;
}

/** Default channel label for MAVLink byte traffic. */
const DEFAULT_DATA_CHANNEL_LABEL = 'mavlink';
/** Default bounded ICE-gather wait before sending the offer through signaling. */
const DEFAULT_ICE_GATHERING_TIMEOUT_MS = 1_000;

/** Connection-form descriptor; signaling itself must be injected by the caller. */
export const WEBRTC_CONFIG_SCHEMA = {
  type: 'object',
  required: ['signaling'],
  properties: {
    signaling: {
      title: 'Injected signaling client',
      description:
        'Object implementing exchangeOffer({ offer, iceCandidates }). The server/protocol is application-provided.',
    },
    rtcConfiguration: {
      title: 'RTCPeerConnection configuration',
      description: 'Optional native RTCConfiguration, e.g. ICE servers.',
      type: 'object',
    },
    dataChannel: {
      title: 'DataChannel options',
      description: 'Optional label/reliability settings; reliable ordered by default.',
      type: 'object',
    },
  },
  additionalProperties: false,
} as const;

/** Normalize an unknown thrown value to an Error. */
function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Return the ambient browser peer factory when WebRTC is available. */
function defaultPeerConnectionFactory(): WebRtcPeerConnectionFactory | undefined {
  if (typeof RTCPeerConnection === 'undefined') return undefined;
  return (configuration?: RTCConfiguration): WebRtcPeerConnectionLike =>
    new RTCPeerConnection(configuration) as unknown as WebRtcPeerConnectionLike;
}

/** Type guard for the injected signaling client. */
function isSignalingClient(value: unknown): value is WebRtcSignalingClient {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { exchangeOffer?: unknown };
  return typeof candidate.exchangeOffer === 'function';
}

/** Validate untyped `open()` config into a {@link WebRtcConfig}. */
function parseConfig(config: unknown): WebRtcConfig {
  if (typeof config !== 'object' || config === null) {
    throw new TypeError('webrtc transport: config must be an object with a signaling client');
  }

  const raw = config as {
    signaling?: unknown;
    rtcConfiguration?: unknown;
    dataChannel?: unknown;
    iceGatheringTimeoutMs?: unknown;
  };
  if (!isSignalingClient(raw.signaling)) {
    throw new TypeError('webrtc transport: config.signaling must implement exchangeOffer(request)');
  }
  if (
    raw.rtcConfiguration !== undefined &&
    (typeof raw.rtcConfiguration !== 'object' || raw.rtcConfiguration === null)
  ) {
    throw new TypeError('webrtc transport: config.rtcConfiguration must be an object');
  }
  if (
    raw.dataChannel !== undefined &&
    (typeof raw.dataChannel !== 'object' || raw.dataChannel === null)
  ) {
    throw new TypeError('webrtc transport: config.dataChannel must be an object');
  }
  if (
    raw.iceGatheringTimeoutMs !== undefined &&
    (typeof raw.iceGatheringTimeoutMs !== 'number' || raw.iceGatheringTimeoutMs < 0)
  ) {
    throw new TypeError(
      'webrtc transport: config.iceGatheringTimeoutMs must be a non-negative number',
    );
  }

  return {
    signaling: raw.signaling,
    ...(raw.rtcConfiguration !== undefined
      ? { rtcConfiguration: raw.rtcConfiguration as RTCConfiguration }
      : {}),
    ...(raw.dataChannel !== undefined
      ? { dataChannel: raw.dataChannel as WebRtcDataChannelConfig }
      : {}),
    ...(raw.iceGatheringTimeoutMs !== undefined
      ? { iceGatheringTimeoutMs: raw.iceGatheringTimeoutMs }
      : {}),
  };
}

/** Build a native RTCDataChannelInit object, preserving exact optional fields. */
function buildDataChannelInit(config: WebRtcDataChannelConfig | undefined): RTCDataChannelInit {
  return {
    ordered: config?.ordered ?? true,
    ...(config?.maxPacketLifeTime !== undefined
      ? { maxPacketLifeTime: config.maxPacketLifeTime }
      : {}),
    ...(config?.maxRetransmits !== undefined ? { maxRetransmits: config.maxRetransmits } : {}),
    ...(config?.protocol !== undefined ? { protocol: config.protocol } : {}),
    ...(config?.negotiated !== undefined ? { negotiated: config.negotiated } : {}),
    ...(config?.id !== undefined ? { id: config.id } : {}),
  };
}

/** Coerce an RTC candidate-like value to RTCIceCandidateInit. */
function iceCandidateToInit(candidate: WebRtcIceCandidateLike): RTCIceCandidateInit {
  if (candidate.toJSON !== undefined) return candidate.toJSON();
  return {
    ...(candidate.candidate !== undefined ? { candidate: candidate.candidate } : {}),
    ...(candidate.sdpMid !== undefined ? { sdpMid: candidate.sdpMid } : {}),
    ...(candidate.sdpMLineIndex !== undefined ? { sdpMLineIndex: candidate.sdpMLineIndex } : {}),
    ...(candidate.usernameFragment !== undefined
      ? { usernameFragment: candidate.usernameFragment }
      : {}),
  };
}

/** Coerce a received DataChannel payload to bytes, or `undefined` for text/etc. */
function toBytes(data: unknown): Uint8Array | undefined {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return undefined;
}

/** Wait for ICE gathering to complete, bounded by a caller-configurable timeout. */
function waitForIceGatheringComplete(
  peer: WebRtcPeerConnectionLike,
  timeoutMs: number,
): Promise<void> {
  if (peer.iceGatheringState === 'complete' || timeoutMs === 0) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.onicegatheringstatechange = null;
      resolve();
    };
    const timer = setTimeout(finish, timeoutMs);
    peer.onicegatheringstatechange = (): void => {
      if (peer.iceGatheringState === 'complete') finish();
    };
  });
}

/** WebRTC DataChannel {@link Transport}. */
export class WebRtcTransport implements Transport {
  readonly id = 'webrtc';
  readonly capabilities = { duplex: true, reconnect: true } as const;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;

  readonly #peerConnectionFactory: WebRtcPeerConnectionFactory | undefined;
  readonly #listeners = new Set<(s: ConnState) => void>();

  #state: ConnState = { kind: 'closed' };
  #peer: WebRtcPeerConnectionLike | undefined;
  #channel: WebRtcDataChannelLike | undefined;
  #signaling: WebRtcSignalingClient | undefined;
  #readableController: ReadableStreamDefaultController<Uint8Array> | undefined;
  #readableClosed = false;
  #closedByUser = false;
  #closeEpoch = 0;
  #pendingChannelOpenReject: ((err: Error) => void) | undefined;
  #reconnectAttempt = 0;

  #bytesIn = 0;
  #bytesOut = 0;
  #packetsIn = 0;

  constructor(options?: WebRtcTransportOptions) {
    this.#peerConnectionFactory = options?.peerConnectionFactory ?? defaultPeerConnectionFactory();

    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#readableController = controller;
      },
      cancel: () => {
        this.#readableClosed = true;
        void this.close();
      },
    });

    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.#send(chunk);
      },
      abort: () => {
        void this.close();
      },
    });
  }

  /** Open the WebRTC link; resolves once signaling completes and the channel opens. */
  async open(config: unknown): Promise<void> {
    if (this.#state.kind !== 'closed') {
      throw new Error('webrtc transport: already open');
    }
    if (this.#readableClosed) {
      throw new Error('transport already consumed; create a new instance');
    }
    const factory = this.#peerConnectionFactory;
    if (factory === undefined) {
      throw new Error('webrtc transport: RTCPeerConnection is not supported in this environment');
    }

    let cfg: WebRtcConfig;
    try {
      cfg = parseConfig(config);
    } catch (err) {
      throw toError(err);
    }

    this.#closedByUser = false;
    const closeEpoch = this.#closeEpoch;
    this.#reconnectAttempt = 0;
    this.#setState({ kind: 'opening' });

    const iceCandidates: RTCIceCandidateInit[] = [];
    let channelOpened: Promise<void>;

    try {
      const peer = factory(cfg.rtcConfiguration);
      this.#peer = peer;
      this.#signaling = cfg.signaling;
      peer.onicecandidate = (ev): void => {
        if (ev.candidate !== null) iceCandidates.push(iceCandidateToInit(ev.candidate));
      };
      peer.onconnectionstatechange = (): void => {
        this.#onPeerConnectionStateChange();
      };

      const label = cfg.dataChannel?.label ?? DEFAULT_DATA_CHANNEL_LABEL;
      const channel = peer.createDataChannel(label, buildDataChannelInit(cfg.dataChannel));
      this.#channel = channel;
      channel.binaryType = 'arraybuffer';
      channelOpened = this.#wireChannel(channel);
      channelOpened.catch(() => undefined);

      const offer = await peer.createOffer();
      this.#throwIfClosedDuringOpen(closeEpoch);
      await peer.setLocalDescription(offer);
      this.#throwIfClosedDuringOpen(closeEpoch);
      await waitForIceGatheringComplete(
        peer,
        cfg.iceGatheringTimeoutMs ?? DEFAULT_ICE_GATHERING_TIMEOUT_MS,
      );
      this.#throwIfClosedDuringOpen(closeEpoch);
      const answer = await cfg.signaling.exchangeOffer({
        offer: peer.localDescription ?? offer,
        iceCandidates,
      });
      this.#throwIfClosedDuringOpen(closeEpoch);
      await peer.setRemoteDescription(answer.answer);
      this.#throwIfClosedDuringOpen(closeEpoch);
      const remoteCandidates = answer.iceCandidates ?? [];
      for (const candidate of remoteCandidates) {
        await peer.addIceCandidate(candidate);
        this.#throwIfClosedDuringOpen(closeEpoch);
      }

      await channelOpened;
      this.#throwIfClosedDuringOpen(closeEpoch);
    } catch (err) {
      this.#teardownPeer();
      this.#setState({ kind: 'closed' });
      throw toError(err);
    }
  }

  /** Close the channel, peer connection, optional signaling client, and readable stream. */
  async close(): Promise<void> {
    this.#closedByUser = true;
    this.#closeEpoch += 1;
    const signaling = this.#signaling;
    this.#teardownPeer();
    this.#closeReadable();
    this.#setState({ kind: 'closed' });
    if (signaling?.close !== undefined) {
      try {
        await signaling.close();
      } catch {
        // Closing a byte transport is best-effort; do not surface signaling cleanup failures.
      }
    }
  }

  /** Subscribe to {@link ConnState}; emits the current state immediately. */
  onState(cb: (s: ConnState) => void): () => void {
    this.#listeners.add(cb);
    cb(this.#state);
    return () => {
      this.#listeners.delete(cb);
    };
  }

  /** Link byte/packet counters. Loss is unknowable here (0); signing is codec-level. */
  stats(): LinkStats {
    return {
      bytesIn: this.#bytesIn,
      bytesOut: this.#bytesOut,
      packetsIn: this.#packetsIn,
      lossPct: 0,
      rateHz: 0,
      signed: false,
    };
  }

  /** Attach DataChannel handlers and return a promise for its first open event. */
  #wireChannel(channel: WebRtcDataChannelLike): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const rejectChannelOpen = (err: Error): void => {
        if (settled) return;
        settled = true;
        if (this.#pendingChannelOpenReject === rejectChannelOpen) {
          this.#pendingChannelOpenReject = undefined;
        }
        reject(err);
      };
      this.#pendingChannelOpenReject = rejectChannelOpen;
      channel.onopen = (): void => {
        if (settled) return;
        settled = true;
        if (this.#pendingChannelOpenReject === rejectChannelOpen) {
          this.#pendingChannelOpenReject = undefined;
        }
        this.#reconnectAttempt = 0;
        this.#setState({ kind: 'open' });
        resolve();
      };
      channel.onmessage = (ev): void => {
        this.#onMessage(ev.data);
      };
      channel.onerror = (): void => {
        const err = new Error('webrtc transport: data channel error');
        if (!this.#closedByUser) this.#setState({ kind: 'error', message: err.message });
        rejectChannelOpen(err);
      };
      channel.onclose = (): void => {
        if (this.#closedByUser) {
          this.#setState({ kind: 'closed' });
          return;
        }
        if (!settled) {
          rejectChannelOpen(new Error('webrtc transport: data channel closed before opening'));
          return;
        }
        this.#emitReconnecting();
      };
    });
  }

  /** React to browser ICE/peer state updates. */
  #onPeerConnectionStateChange(): void {
    const peer = this.#peer;
    if (peer === undefined || this.#closedByUser) return;
    switch (peer.connectionState) {
      case 'connected':
        if (this.#channel?.readyState === 'open') {
          this.#reconnectAttempt = 0;
          this.#setState({ kind: 'open' });
        }
        break;
      case 'connecting':
      case 'disconnected':
        if (this.#state.kind === 'open') this.#emitReconnecting();
        break;
      case 'failed':
        this.#setState({ kind: 'error', message: 'webrtc transport: peer connection failed' });
        break;
      case 'closed':
        this.#setState({ kind: 'closed' });
        break;
      case 'new':
      case undefined:
        break;
    }
  }

  /** Emit a reconnecting state used while ICE attempts to recover the link. */
  #emitReconnecting(): void {
    this.#reconnectAttempt += 1;
    this.#setState({ kind: 'reconnecting', attempt: this.#reconnectAttempt });
  }

  /** Enqueue an inbound binary message onto the readable stream. */
  #onMessage(data: unknown): void {
    if (this.#readableClosed) return;
    const bytes = toBytes(data);
    if (bytes === undefined) return;
    this.#bytesIn += bytes.byteLength;
    this.#packetsIn += 1;
    this.#readableController?.enqueue(bytes);
  }

  /**
   * Send outbound bytes when the DataChannel is open. MAVLink is loss-tolerant,
   * so writes during `opening`/`reconnecting`/`closed` are dropped silently and
   * never buffered; throwing would error the WritableStream irrecoverably.
   */
  #send(chunk: Uint8Array): void {
    const channel = this.#channel;
    if (channel === undefined || this.#state.kind !== 'open' || channel.readyState !== 'open') {
      return;
    }
    channel.send(chunk);
    this.#bytesOut += chunk.byteLength;
  }

  /** Reject an in-flight open when a user close interleaves with async setup. */
  #throwIfClosedDuringOpen(closeEpoch: number): void {
    if (this.#closedByUser || this.#closeEpoch !== closeEpoch) {
      throw new Error('closed by user');
    }
  }

  /** Detach and close channel/peer resources without closing the readable stream. */
  #teardownPeer(): void {
    const pendingChannelOpenReject = this.#pendingChannelOpenReject;
    this.#pendingChannelOpenReject = undefined;
    pendingChannelOpenReject?.(new Error('closed by user'));
    const channel = this.#channel;
    this.#channel = undefined;
    if (channel !== undefined) {
      channel.onopen = null;
      channel.onmessage = null;
      channel.onclose = null;
      channel.onerror = null;
      channel.close();
    }

    const peer = this.#peer;
    this.#peer = undefined;
    if (peer !== undefined) {
      peer.onconnectionstatechange = null;
      peer.onicegatheringstatechange = null;
      peer.onicecandidate = null;
      peer.close();
    }
    this.#signaling = undefined;
  }

  /** Close the readable stream's controller exactly once (idempotent). */
  #closeReadable(): void {
    if (this.#readableClosed) return;
    this.#readableClosed = true;
    this.#readableController?.close();
  }

  /** Record and broadcast a state transition. */
  #setState(state: ConnState): void {
    this.#state = state;
    for (const cb of this.#listeners) cb(state);
  }
}

/** Build a `'webrtc'` {@link TransportFactory}. */
export function createWebRtcTransportFactory(options?: WebRtcTransportOptions): TransportFactory {
  return {
    id: 'webrtc',
    label: 'WebRTC DataChannel',
    isSupported: (): boolean => {
      if (options?.peerConnectionFactory !== undefined) return true;
      return typeof RTCPeerConnection !== 'undefined';
    },
    configSchema: WEBRTC_CONFIG_SCHEMA,
    create: (): Transport => new WebRtcTransport(options),
  };
}

/** The default WebRTC DataChannel transport factory. */
export const webRtcTransportFactory: TransportFactory = createWebRtcTransportFactory();

/** Lowercase-id alias matching the transport id spelling (`'webrtc'`). */
export const webrtcTransportFactory: TransportFactory = webRtcTransportFactory;
