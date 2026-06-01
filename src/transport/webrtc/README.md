# `transport/webrtc` — WebRTC DataChannel transport (T8.4)

Low-latency remote MAVLink byte transport over a WebRTC `RTCDataChannel` (spec
`plan/03` §3.5 item 5). The module implements the frozen
`Transport`/`TransportFactory` seam with id `'webrtc'`.

## Contract

```ts
const factory = createWebRtcTransportFactory();
const transport = factory.create();
await transport.open({ signaling });
transport.readable; // ReadableStream<Uint8Array> from datachannel messages
transport.writable; // WritableStream<Uint8Array> -> datachannel.send
transport.onState((s) => …); // closed/opening/open/reconnecting/error
transport.stats(); // bytesIn/bytesOut/packetsIn, lossPct 0, signed false
await transport.close();
```

`open(config)` creates an `RTCPeerConnection`, creates a reliable ordered
`RTCDataChannel` by default (`label: 'mavlink'`, `ordered: true`), gathers local
ICE candidates for a bounded interval, then calls the injected signaling client:

```ts
interface WebRtcSignalingClient {
  exchangeOffer(request: {
    offer: RTCSessionDescriptionInit;
    iceCandidates: readonly RTCIceCandidateInit[];
  }): Promise<{
    answer: RTCSessionDescriptionInit;
    iceCandidates?: readonly RTCIceCandidateInit[];
  }>;
  close?(): void | Promise<void>;
}
```

No signaling server or wire protocol is hard-bound here; applications provide the
client object (WebSocket, HTTP, QR/manual exchange, etc.). Remote ICE candidates
returned with the answer are added before `open()` waits for the DataChannel to
fire `onopen` and emits `{ kind: 'open' }`.

## Send policy

Writes are delivered only when the transport state is `open` and the
DataChannel `readyState` is `open`. Writes during `opening`, `reconnecting`, or
`closed` are **dropped silently and not buffered**. This mirrors the
loss-tolerant WebSocket transport policy: MAVLink can tolerate transient loss,
while throwing would permanently error the `WritableStream` after one gap.

## Testability

`WebRtcTransport` / `createWebRtcTransportFactory` accept an injected
`peerConnectionFactory`. Unit tests use fake peer connections, fake signaling,
and fake data channels to drive `createOffer`, `setLocalDescription`, signaling
answer/ICE exchange, `onopen`, `onmessage(ArrayBuffer)`, and `onclose` without a
browser network stack. `isSupported()` returns `true` with an injected factory;
otherwise it reflects `typeof RTCPeerConnection !== 'undefined'`.

## Owned files

- `webrtc-transport.ts` — transport, factory, signaling seam, config schema.
- `index.ts` — public barrel.

## How to test

```sh
npx vitest run test/unit/transport-webrtc*.test.ts
npx eslint src/transport/webrtc test/unit/transport-webrtc*.test.ts
```
