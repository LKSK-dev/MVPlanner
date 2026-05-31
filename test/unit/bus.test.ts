import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createEventBus } from '../../src/core/bus/event-bus';
import { createRpc, type PostMessageRpc } from '../../src/core/bus/rpc';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// EventBus
// ---------------------------------------------------------------------------
describe('EventBus', () => {
  it('delivers emitted payloads to subscribers', () => {
    const bus = createEventBus();
    const seen: number[] = [];
    bus.on<number>('tick', (n) => seen.push(n));
    bus.emit<number>('tick', 1);
    bus.emit<number>('tick', 2);
    expect(seen).toEqual([1, 2]);
  });

  it('isolates topics and supports multiple subscribers', () => {
    const bus = createEventBus();
    const a: string[] = [];
    const b: string[] = [];
    bus.on<string>('a', (v) => a.push(v));
    bus.on<string>('a', (v) => b.push(v));
    bus.on<string>('other', () => a.push('NOPE'));
    bus.emit<string>('a', 'hi');
    expect(a).toEqual(['hi']);
    expect(b).toEqual(['hi']);
  });

  it('stops delivering after the disposer is called', () => {
    const bus = createEventBus();
    const seen: number[] = [];
    const off = bus.on<number>('tick', (n) => seen.push(n));
    bus.emit<number>('tick', 1);
    off();
    bus.emit<number>('tick', 2);
    off(); // idempotent
    expect(seen).toEqual([1]);
  });

  it('lets a listener unsubscribe during emit without affecting the in-flight delivery', () => {
    const bus = createEventBus();
    const seen: string[] = [];
    const off = bus.on<string>('t', (v) => {
      seen.push(`one:${v}`);
      off();
    });
    bus.on<string>('t', (v) => seen.push(`two:${v}`));
    bus.emit<string>('t', 'x');
    bus.emit<string>('t', 'y');
    expect(seen).toEqual(['one:x', 'two:x', 'two:y']);
  });
});

// ---------------------------------------------------------------------------
// Rpc over a MessageChannel
// ---------------------------------------------------------------------------
describe('Rpc (over MessageChannel)', () => {
  let channel: MessageChannel;
  let client: PostMessageRpc;
  let server: PostMessageRpc;

  beforeEach(() => {
    channel = new MessageChannel();
    client = createRpc(channel.port1);
    server = createRpc(channel.port2);
  });

  afterEach(() => {
    client.dispose();
    server.dispose();
    channel.port1.close();
    channel.port2.close();
  });

  it('round-trips a call request → response', async () => {
    server.handle<{ a: number; b: number }, number>('add', async (req) => req.a + req.b);
    const sum = await client.call<{ a: number; b: number }, number>('add', { a: 2, b: 3 });
    expect(sum).toBe(5);
  });

  it('propagates a handler error to the caller as a rejection', async () => {
    server.handle<void, never>('boom', async () => {
      throw new TypeError('kaboom');
    });
    await expect(client.call('boom', undefined)).rejects.toMatchObject({
      name: 'TypeError',
      message: 'kaboom',
    });
  });

  it('rejects when no handler is registered for the method', async () => {
    await expect(client.call('missing', 1)).rejects.toThrow(/No handler for "missing"/);
  });

  it('cancels an in-flight call via AbortSignal and aborts the handler', async () => {
    let handlerSignalAborted = false;
    server.handle<void, void>('hang', (_req, signal) => {
      return new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          handlerSignalAborted = true;
          reject(signal.reason);
        });
      });
    });
    const ac = new AbortController();
    const reason = new Error('caller cancelled');
    const p = client.call('hang', undefined, { signal: ac.signal });
    await delay(5);
    ac.abort(reason);
    await expect(p).rejects.toBe(reason);
    await delay(10);
    expect(handlerSignalAborted).toBe(true);
  });

  it('delivers multiple stream messages then resolves on end', async () => {
    server.handleStream<{ n: number }, number>('count', async (req, send) => {
      for (let i = 0; i < req.n; i++) send(i);
    });
    const received: number[] = [];
    await client.stream<{ n: number }, number>('count', { n: 4 }, (m) => received.push(m));
    expect(received).toEqual([0, 1, 2, 3]);
  });

  it('surfaces a streaming handler error as a stream rejection', async () => {
    server.handleStream<void, number>('halfway', async (_req, send) => {
      send(1);
      throw new Error('stream broke');
    });
    const received: number[] = [];
    await expect(
      client.stream<void, number>('halfway', undefined, (m) => received.push(m)),
    ).rejects.toThrow(/stream broke/);
    expect(received).toEqual([1]);
  });

  it('cancels a stream via AbortSignal and stops delivering messages', async () => {
    let handlerSignalAborted = false;
    server.handleStream<{ n: number }, number>('drip', async (req, send, signal) => {
      signal.addEventListener('abort', () => {
        handlerSignalAborted = true;
      });
      for (let i = 0; i < req.n; i++) {
        if (signal.aborted) return;
        send(i);
        await delay(5);
      }
    });

    const ac = new AbortController();
    const reason = new Error('stop streaming');
    const received: number[] = [];
    const p = client.stream<{ n: number }, number>(
      'drip',
      { n: 100 },
      (m) => {
        received.push(m);
        if (received.length === 3) ac.abort(reason);
      },
      { signal: ac.signal },
    );

    await expect(p).rejects.toBe(reason);
    const countAtCancel = received.length;
    expect(countAtCancel).toBeGreaterThanOrEqual(3);

    // Let cancel propagate; no further messages should be observed by the caller.
    await delay(30);
    expect(received.length).toBe(countAtCancel);
    expect(handlerSignalAborted).toBe(true);
  });

  it('supports a bidirectional endpoint (each side both calls and handles)', async () => {
    server.handle<string, string>('echo', async (s) => `srv:${s}`);
    client.handle<string, string>('echo', async (s) => `cli:${s}`);
    const fromServer = await client.call<string, string>('echo', 'ping');
    const fromClient = await server.call<string, string>('echo', 'pong');
    expect(fromServer).toBe('srv:ping');
    expect(fromClient).toBe('cli:pong');
  });
});
