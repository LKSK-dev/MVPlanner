import { describe, it, expect, beforeEach } from 'vitest';
import {
  WebRtcTransport,
  createWebRtcTransportFactory,
  webRtcTransportFactory,
  WEBRTC_CONFIG_SCHEMA,
  type WebRtcDataChannelLike,
  type WebRtcIceCandidateEventLike,
  type WebRtcPeerConnectionFactory,
  type WebRtcPeerConnectionLike,
  type WebRtcSignalingClient,
  type WebRtcSignalingOffer,
} from '../../src/transport/webrtc';
import type { ConnState } from '../../src/contracts';

/** Tracks all fake peers created by the injected factory. */
const createdPeers: FakePeerConnection[] = [];

/** Fake RTCDataChannel driven directly by tests. */
class FakeDataChannel implements WebRtcDataChannelLike {
  binaryType: BinaryType = 'blob';
  readyState: RTCDataChannelState = 'connecting';
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: ArrayBufferView[] = [];
  closed = false;

  send(data: ArrayBufferView): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
    this.readyState = 'closed';
  }

  emitOpen(): void {
    this.readyState = 'open';
    this.onopen?.();
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  emitClose(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }
}

/** Fake RTCPeerConnection: records offer/answer/ICE and exposes one channel. */
class FakePeerConnection implements WebRtcPeerConnectionLike {
  connectionState: RTCPeerConnectionState = 'new';
  iceGatheringState: RTCIceGatheringState = 'new';
  localDescription: RTCSessionDescriptionInit | null = null;
  remoteDescription: RTCSessionDescriptionInit | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  onicecandidate: ((ev: WebRtcIceCandidateEventLike) => void) | null = null;
  readonly channel = new FakeDataChannel();
  readonly remoteCandidates: RTCIceCandidateInit[] = [];
  readonly createdChannels: { label: string; options?: RTCDataChannelInit }[] = [];
  readonly configuration?: RTCConfiguration;
  closed = false;

  constructor(configuration?: RTCConfiguration) {
    if (configuration !== undefined) this.configuration = configuration;
    createdPeers.push(this);
  }

  createDataChannel(label: string, options?: RTCDataChannelInit): WebRtcDataChannelLike {
    this.createdChannels.push(options === undefined ? { label } : { label, options });
    return this.channel;
  }

  createOffer(): Promise<RTCSessionDescriptionInit> {
    return Promise.resolve({ type: 'offer', sdp: 'fake-offer' });
  }

  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.localDescription = description;
    this.onicecandidate?.({
      candidate: {
        candidate: 'candidate:local',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    });
    this.iceGatheringState = 'complete';
    this.onicegatheringstatechange?.();
    return Promise.resolve();
  }

  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDescription = description;
    return Promise.resolve();
  }

  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    this.remoteCandidates.push(candidate);
    return Promise.resolve();
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }
}

const peerConnectionFactory: WebRtcPeerConnectionFactory = (configuration?: RTCConfiguration) =>
  new FakePeerConnection(configuration);

/** Fake signaling client that captures the local offer and returns a remote answer. */
class FakeSignaling implements WebRtcSignalingClient {
  readonly offers: WebRtcSignalingOffer[] = [];
  closeCalls = 0;

  exchangeOffer(offer: WebRtcSignalingOffer): Promise<{
    answer: RTCSessionDescriptionInit;
    iceCandidates: readonly RTCIceCandidateInit[];
  }> {
    this.offers.push(offer);
    return Promise.resolve({
      answer: { type: 'answer', sdp: 'fake-answer' },
      iceCandidates: [{ candidate: 'candidate:remote', sdpMid: '0', sdpMLineIndex: 0 }],
    });
  }

  close(): void {
    this.closeCalls += 1;
  }
}

function setup(): {
  transport: WebRtcTransport;
  signaling: FakeSignaling;
  states: ConnState[];
} {
  const transport = new WebRtcTransport({ peerConnectionFactory });
  const signaling = new FakeSignaling();
  const states: ConnState[] = [];
  transport.onState((s) => states.push(s));
  return { transport, signaling, states };
}

/** Open the transport and drive the fake channel to `open`. */
async function openTransport(
  transport: WebRtcTransport,
  signaling: FakeSignaling,
): Promise<FakePeerConnection> {
  const openPromise = transport.open({ signaling, iceGatheringTimeoutMs: 0 });
  const peer = createdPeers[createdPeers.length - 1];
  expect(peer).toBeDefined();
  if (peer === undefined) throw new Error('no fake peer created');
  peer.channel.emitOpen();
  await openPromise;
  return peer;
}

beforeEach(() => {
  createdPeers.length = 0;
});

describe('WebRtcTransport', () => {
  it('implements the Transport contract surface', () => {
    const { transport } = setup();
    expect(transport.id).toBe('webrtc');
    expect(transport.capabilities).toEqual({ duplex: true, reconnect: true });
    expect(transport.readable).toBeInstanceOf(ReadableStream);
    expect(transport.writable).toBeInstanceOf(WritableStream);
  });

  it('rejects config without an injected signaling client', async () => {
    const { transport } = setup();
    await expect(transport.open({})).rejects.toThrow(/signaling/);
  });

  it('performs offer/answer + ICE exchange and opens on channel onopen', async () => {
    const { transport, signaling, states } = setup();
    const peer = await openTransport(transport, signaling);

    expect(peer.channel.binaryType).toBe('arraybuffer');
    expect(peer.createdChannels).toEqual([{ label: 'mavlink', options: { ordered: true } }]);
    expect(signaling.offers.length).toBe(1);
    expect(signaling.offers[0]!.offer).toEqual({ type: 'offer', sdp: 'fake-offer' });
    expect(signaling.offers[0]!.iceCandidates).toEqual([
      { candidate: 'candidate:local', sdpMid: '0', sdpMLineIndex: 0 },
    ]);
    expect(peer.remoteDescription).toEqual({ type: 'answer', sdp: 'fake-answer' });
    expect(peer.remoteCandidates).toEqual([
      { candidate: 'candidate:remote', sdpMid: '0', sdpMLineIndex: 0 },
    ]);
    expect(states.map((s) => s.kind)).toEqual(['closed', 'opening', 'open']);
  });

  it('routes onmessage(ArrayBuffer) bytes onto the readable stream', async () => {
    const { transport, signaling } = setup();
    const peer = await openTransport(transport, signaling);
    const reader = transport.readable.getReader();

    peer.channel.emitMessage(new Uint8Array([1, 2, 3]).buffer);
    const first = await reader.read();
    expect(first.value).toEqual(new Uint8Array([1, 2, 3]));

    peer.channel.emitMessage(new Uint8Array([4, 5]));
    const second = await reader.read();
    expect(second.value).toEqual(new Uint8Array([4, 5]));
    reader.releaseLock();
  });

  it('writes are forwarded to channel.send and counted in stats', async () => {
    const { transport, signaling } = setup();
    const peer = await openTransport(transport, signaling);
    const writer = transport.writable.getWriter();

    await writer.write(new Uint8Array([7, 8, 9]));
    expect(peer.channel.sent.length).toBe(1);
    const sent = peer.channel.sent[0]!;
    expect(new Uint8Array(sent.buffer, sent.byteOffset, sent.byteLength)).toEqual(
      new Uint8Array([7, 8, 9]),
    );
    expect(transport.stats()).toEqual({
      bytesIn: 0,
      bytesOut: 3,
      packetsIn: 0,
      lossPct: 0,
      rateHz: 0,
      signed: false,
    });
    writer.releaseLock();
  });

  it('drops send-while-not-open without throwing or buffering', async () => {
    const { transport, signaling } = setup();
    const writer = transport.writable.getWriter();

    await expect(writer.write(new Uint8Array([1]))).resolves.toBeUndefined();
    const peer = await openTransport(transport, signaling);
    expect(peer.channel.sent.length).toBe(0);

    peer.channel.emitClose();
    await expect(writer.write(new Uint8Array([2]))).resolves.toBeUndefined();
    expect(peer.channel.sent.length).toBe(0);
    expect(transport.stats().bytesOut).toBe(0);
    writer.releaseLock();
  });

  it('close during open rejects the pending open promise', async () => {
    const { transport, signaling, states } = setup();
    const pendingOpen = transport.open({ signaling, iceGatheringTimeoutMs: 0 });
    const rejection = expect(pendingOpen).rejects.toThrow('closed by user');
    const peer = createdPeers[createdPeers.length - 1]!;

    await transport.close();

    expect(peer.channel.closed).toBe(true);
    expect(peer.closed).toBe(true);
    expect(states[states.length - 1]).toEqual({ kind: 'closed' });
    await rejection;
  });

  it('close tears down channel, peer, signaling and emits closed', async () => {
    const { transport, signaling, states } = setup();
    const peer = await openTransport(transport, signaling);
    const reader = transport.readable.getReader();

    await transport.close();

    expect(peer.channel.closed).toBe(true);
    expect(peer.closed).toBe(true);
    expect(signaling.closeCalls).toBe(1);
    expect(states[states.length - 1]).toEqual({ kind: 'closed' });
    expect((await reader.read()).done).toBe(true);
    reader.releaseLock();
  });

  it('rejects reopen after close because the readable is single-use', async () => {
    const { transport, signaling } = setup();
    await openTransport(transport, signaling);
    await transport.close();

    await expect(transport.open({ signaling, iceGatheringTimeoutMs: 0 })).rejects.toThrow(
      'transport already consumed; create a new instance',
    );
  });

  it('emits reconnecting when the peer reports a transient disconnect', async () => {
    const { transport, signaling, states } = setup();
    const peer = await openTransport(transport, signaling);

    peer.connectionState = 'disconnected';
    peer.onconnectionstatechange?.();

    expect(states[states.length - 1]).toEqual({ kind: 'reconnecting', attempt: 1 });
  });
});

describe('createWebRtcTransportFactory', () => {
  it('isSupported() is true when a peer-connection factory is injected', () => {
    const factory = createWebRtcTransportFactory({ peerConnectionFactory });
    expect(factory.isSupported()).toBe(true);
  });

  it('isSupported() reflects ambient RTCPeerConnection otherwise', () => {
    expect(typeof webRtcTransportFactory.isSupported()).toBe('boolean');
  });

  it('exposes id, label, config schema and creates a transport', () => {
    const factory = createWebRtcTransportFactory({ peerConnectionFactory });
    expect(factory.id).toBe('webrtc');
    expect(factory.label).toBe('WebRTC DataChannel');
    expect(factory.configSchema).toBe(WEBRTC_CONFIG_SCHEMA);
    expect(WEBRTC_CONFIG_SCHEMA.required).toContain('signaling');
    expect(factory.create().id).toBe('webrtc');
  });
});
