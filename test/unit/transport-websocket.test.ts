import { describe, it, expect, beforeEach } from 'vitest';
import {
  WebSocketTransport,
  createWebSocketTransportFactory,
  websocketTransportFactory,
  WEBSOCKET_CONFIG_SCHEMA,
  type Scheduler,
  type WebSocketCtor,
  type WebSocketLike,
} from '../../src/transport/websocket';
import type { ConnState } from '../../src/contracts';

/** Tracks all sockets a factory creates so tests can drive each generation. */
const created: FakeWebSocket[] = [];

/** Fake {@link WebSocketLike}: tests drive open/message/close manually. */
class FakeWebSocket implements WebSocketLike {
  url: string;
  binaryType = 'blob';
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code?: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly sent: ArrayBufferView[] = [];
  closed = false;

  constructor(url: string) {
    this.url = url;
    created.push(this);
  }

  send(data: ArrayBufferView): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  // --- test drivers ---
  emitOpen(): void {
    this.onopen?.();
  }
  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }
  emitClose(): void {
    this.onclose?.({ code: 1006 });
  }
  emitError(): void {
    this.onerror?.();
  }
}

const FakeCtor = FakeWebSocket as unknown as WebSocketCtor;

/** Manual single-shot scheduler: capture the pending timer, flush on demand. */
function makeManualScheduler(): {
  scheduler: Scheduler;
  flush: () => void;
  pending: () => { delayMs: number } | null;
} {
  let pending: { cb: () => void; delayMs: number } | null = null;
  return {
    scheduler: {
      schedule(cb, delayMs): void {
        pending = { cb, delayMs };
      },
      cancel(): void {
        pending = null;
      },
    },
    flush(): void {
      const p = pending;
      pending = null;
      p?.cb();
    },
    pending: () => (pending === null ? null : { delayMs: pending.delayMs }),
  };
}

const URL = 'ws://localhost:5760';

function setup(scheduler?: Scheduler): {
  transport: WebSocketTransport;
  states: ConnState[];
} {
  const transport = new WebSocketTransport({
    WebSocketCtor: FakeCtor,
    backoffBaseMs: 500,
    backoffMaxMs: 16_000,
    ...(scheduler ? { scheduler } : {}),
  });
  const states: ConnState[] = [];
  transport.onState((s) => states.push(s));
  return { transport, states };
}

/** Open the transport and drive the fake socket to the `open` state. */
async function openTransport(transport: WebSocketTransport): Promise<FakeWebSocket> {
  const p = transport.open({ url: URL });
  const ws = created[created.length - 1];
  expect(ws).toBeDefined();
  if (ws === undefined) throw new Error('no socket created');
  ws.emitOpen();
  await p;
  return ws;
}

beforeEach(() => {
  created.length = 0;
});

describe('WebSocketTransport', () => {
  it('implements the Transport contract surface', () => {
    const { transport } = setup();
    expect(transport.id).toBe('websocket');
    expect(transport.capabilities).toEqual({ duplex: true, reconnect: true });
    expect(transport.readable).toBeInstanceOf(ReadableStream);
    expect(transport.writable).toBeInstanceOf(WritableStream);
  });

  it('rejects a config without a ws:// url', async () => {
    const { transport } = setup();
    await expect(transport.open({})).rejects.toThrow(/url/);
    await expect(transport.open({ url: 'http://nope' })).rejects.toThrow(/ws:\/\//);
  });

  it('open() resolves on onopen and emits opening then open', async () => {
    const { transport, states } = setup();
    const ws = await openTransport(transport);
    expect(ws.binaryType).toBe('arraybuffer');
    expect(states.map((s) => s.kind)).toEqual(['closed', 'opening', 'open']);
  });

  it('routes onmessage(ArrayBuffer) bytes onto the readable stream', async () => {
    const { transport } = setup();
    const ws = await openTransport(transport);
    const reader = transport.readable.getReader();
    ws.emitMessage(new Uint8Array([1, 2, 3, 4]).buffer);
    const first = await reader.read();
    expect(first.value).toEqual(new Uint8Array([1, 2, 3, 4]));

    // ArrayBufferView payloads are accepted too.
    ws.emitMessage(new Uint8Array([9, 9]));
    const second = await reader.read();
    expect(second.value).toEqual(new Uint8Array([9, 9]));
    reader.releaseLock();
  });

  it('writes are forwarded to socket.send', async () => {
    const { transport } = setup();
    const ws = await openTransport(transport);
    const writer = transport.writable.getWriter();
    await writer.write(new Uint8Array([7, 8, 9]));
    expect(ws.sent.length).toBe(1);
    expect(
      new Uint8Array(ws.sent[0]!.buffer, ws.sent[0]!.byteOffset, ws.sent[0]!.byteLength),
    ).toEqual(new Uint8Array([7, 8, 9]));
    writer.releaseLock();
  });

  it('counts bytes/packets in stats with lossPct 0 and signed false', async () => {
    const { transport } = setup();
    const ws = await openTransport(transport);
    ws.emitMessage(new Uint8Array([1, 2, 3]).buffer);
    const writer = transport.writable.getWriter();
    await writer.write(new Uint8Array([4, 5]));
    writer.releaseLock();
    expect(transport.stats()).toEqual({
      bytesIn: 3,
      bytesOut: 2,
      packetsIn: 1,
      lossPct: 0,
      rateHz: 0,
      signed: false,
    });
  });

  it('an unexpected close triggers reconnecting with backoff, then reconnects', async () => {
    const manual = makeManualScheduler();
    const { transport, states } = setup(manual.scheduler);
    const ws1 = await openTransport(transport);

    ws1.emitClose();
    expect(states[states.length - 1]).toEqual({ kind: 'reconnecting', attempt: 1 });
    expect(manual.pending()).toEqual({ delayMs: 500 });

    // Backoff fires -> a brand new socket is created.
    const before = created.length;
    manual.flush();
    expect(created.length).toBe(before + 1);
    const ws2 = created[created.length - 1]!;
    ws2.emitOpen();
    expect(states[states.length - 1]).toEqual({ kind: 'open' });
  });

  it('grows the backoff exponentially and bounds it, resetting after reconnect', async () => {
    const manual = makeManualScheduler();
    const transport = new WebSocketTransport({
      WebSocketCtor: FakeCtor,
      backoffBaseMs: 500,
      backoffMaxMs: 2_000,
      scheduler: manual.scheduler,
    });
    await openTransport(transport);

    // First failed attempt: 500ms.
    created[created.length - 1]!.emitClose();
    expect(manual.pending()).toEqual({ delayMs: 500 });
    manual.flush();

    // Reconnect attempt closes again before opening: attempt 2 -> 1000ms.
    created[created.length - 1]!.emitClose();
    expect(manual.pending()).toEqual({ delayMs: 1_000 });
    manual.flush();

    // attempt 3 -> 2000ms; attempt 4 -> bounded at 2000ms.
    created[created.length - 1]!.emitClose();
    expect(manual.pending()).toEqual({ delayMs: 2_000 });
    manual.flush();
    created[created.length - 1]!.emitClose();
    expect(manual.pending()).toEqual({ delayMs: 2_000 });
    manual.flush();

    // A successful reconnect resets the attempt counter.
    created[created.length - 1]!.emitOpen();
    created[created.length - 1]!.emitClose();
    expect(manual.pending()).toEqual({ delayMs: 500 });
  });

  it('close() cancels pending backoff and lands in closed', async () => {
    const manual = makeManualScheduler();
    const { transport, states } = setup(manual.scheduler);
    const ws = await openTransport(transport);

    ws.emitClose();
    expect(manual.pending()).toEqual({ delayMs: 500 });

    await transport.close();
    expect(manual.pending()).toBeNull();
    expect(states[states.length - 1]).toEqual({ kind: 'closed' });

    // A cancelled backoff that somehow fires must not reconnect.
    const before = created.length;
    manual.flush();
    expect(created.length).toBe(before);
  });

  it('close() during initial open rejects the pending open promise', async () => {
    const { transport, states } = setup();
    const pendingOpen = transport.open({ url: URL });
    const rejection = expect(pendingOpen).rejects.toThrow('closed by user');
    const ws = created[created.length - 1]!;

    await transport.close();

    expect(ws.closed).toBe(true);
    expect(states[states.length - 1]).toEqual({ kind: 'closed' });
    await rejection;
  });

  it('close() while connected closes the underlying socket', async () => {
    const { transport, states } = setup();
    const ws = await openTransport(transport);
    await transport.close();
    expect(ws.closed).toBe(true);
    expect(states[states.length - 1]).toEqual({ kind: 'closed' });
  });

  it('close() closes the readable so a downstream reader sees done', async () => {
    const { transport } = setup();
    await openTransport(transport);
    const reader = transport.readable.getReader();
    await transport.close();
    expect((await reader.read()).done).toBe(true);
    // Double-close is a no-op and must not throw on the already-closed stream.
    await expect(transport.close()).resolves.toBeUndefined();
    reader.releaseLock();
  });

  it('rejects reopen after close because the readable is single-use', async () => {
    const { transport } = setup();
    await openTransport(transport);
    await transport.close();

    await expect(transport.open({ url: URL })).rejects.toThrow(
      'transport already consumed; create a new instance',
    );
  });

  it('rejects open() when the initial connect closes before opening', async () => {
    const { transport, states } = setup();
    const p = transport.open({ url: URL });
    const ws = created[created.length - 1]!;
    ws.emitClose();
    await expect(p).rejects.toThrow(/failed to connect/);
    expect(states[states.length - 1]).toEqual({ kind: 'closed' });
  });

  it('drops writes silently while not open, keeping the writable usable after reconnect', async () => {
    const manual = makeManualScheduler();
    const { transport } = setup(manual.scheduler);
    const ws1 = await openTransport(transport);
    const writer = transport.writable.getWriter();

    // A normal write while open is delivered.
    await writer.write(new Uint8Array([1]));
    expect(ws1.sent.length).toBe(1);

    // Simulate an unexpected drop -> reconnecting gap.
    ws1.emitClose();

    // A write during the gap is dropped silently (resolves, never throws) and
    // is not buffered: the WritableStream must NOT be errored irrecoverably.
    await expect(writer.write(new Uint8Array([2]))).resolves.toBeUndefined();

    // Backoff fires and the new socket reopens.
    manual.flush();
    const ws2 = created[created.length - 1]!;
    ws2.emitOpen();

    // The writable survived the reconnect: a subsequent write is delivered.
    await writer.write(new Uint8Array([3]));
    expect(ws2.sent.length).toBe(1);
    expect(
      new Uint8Array(ws2.sent[0]!.buffer, ws2.sent[0]!.byteOffset, ws2.sent[0]!.byteLength),
    ).toEqual(new Uint8Array([3]));
    // The dropped chunk never reached either socket and is not counted.
    expect(transport.stats().bytesOut).toBe(2); // bytes [1] + [3], not [2]
    writer.releaseLock();
  });

  it('drops a write while never connected without erroring the writable', async () => {
    const { transport } = setup();
    const writer = transport.writable.getWriter();
    await expect(writer.write(new Uint8Array([1]))).resolves.toBeUndefined();
    writer.releaseLock();
  });
});

describe('createWebSocketTransportFactory', () => {
  it('isSupported() is true when a WebSocket constructor is injected', () => {
    const factory = createWebSocketTransportFactory({ WebSocketCtor: FakeCtor });
    expect(factory.isSupported()).toBe(true);
  });

  it('isSupported() reflects the ambient WebSocket otherwise', () => {
    expect(typeof websocketTransportFactory.isSupported()).toBe('boolean');
  });

  it('exposes id, label, a url config schema and creates a transport', () => {
    const factory = createWebSocketTransportFactory({ WebSocketCtor: FakeCtor });
    expect(factory.id).toBe('websocket');
    expect(factory.label).toBe('WebSocket bridge');
    expect(factory.configSchema).toBe(WEBSOCKET_CONFIG_SCHEMA);
    expect(WEBSOCKET_CONFIG_SCHEMA.required).toContain('url');
    const transport = factory.create();
    expect(transport.id).toBe('websocket');
  });
});
