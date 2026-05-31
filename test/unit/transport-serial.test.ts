import { describe, it, expect } from 'vitest';
import {
  SerialTransport,
  createSerialTransportFactory,
  serialTransportFactory,
  DEFAULT_BAUD_RATE,
  type ConnState,
  type SerialPortLike,
  type SerialPortOpenOptions,
  type SerialProviderLike,
} from '../../src/transport/serial';

/**
 * Fake Web Serial `SerialPort` backed by real `ReadableStream`/`WritableStream`
 * (Node globals under the happy-dom env). `pushRx` feeds inbound bytes; `written`
 * collects everything the transport sends; `emitDisconnect` simulates a re-plug.
 */
class FakeSerialPort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  readonly written: Uint8Array[] = [];
  opened = false;
  closed = false;
  openOptions: SerialPortOpenOptions | null = null;

  #rxController: ReadableStreamDefaultController<Uint8Array> | null = null;
  readonly #disconnect = new Set<() => void>();

  async open(options: SerialPortOpenOptions): Promise<void> {
    this.openOptions = options;
    this.opened = true;
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#rxController = controller;
      },
    });
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        this.written.push(chunk);
      },
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.readable = null;
    this.writable = null;
  }

  addEventListener(type: 'disconnect', listener: () => void): void {
    if (type === 'disconnect') this.#disconnect.add(listener);
  }

  removeEventListener(type: 'disconnect', listener: () => void): void {
    if (type === 'disconnect') this.#disconnect.delete(listener);
  }

  /** Test helper: push inbound bytes through the port's readable. */
  pushRx(bytes: Uint8Array): void {
    this.#rxController?.enqueue(bytes);
  }

  /** Test helper: fire the `disconnect` (re-plug) event. */
  emitDisconnect(): void {
    for (const listener of [...this.#disconnect]) listener();
  }
}

/** A provider that hands out a single pre-built fake port. */
function providerFor(port: SerialPortLike): SerialProviderLike {
  return { requestPort: async () => port };
}

/** Poll until `pred` holds, or fail after ~100ms. */
async function until(pred: () => boolean, label: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (pred()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`timeout waiting for ${label}`);
}

/** Collect every state a transport emits for assertions on transitions. */
function collectStates(t: SerialTransport): { states: ConnState[]; dispose: () => void } {
  const states: ConnState[] = [];
  const dispose = t.onState((s) => states.push(s));
  return { states, dispose };
}

describe('SerialTransport lifecycle', () => {
  it('opens and closes a port with the expected state transitions', async () => {
    const port = new FakeSerialPort();
    const t = new SerialTransport({ provider: providerFor(port) });
    const { states } = collectStates(t);

    await t.open({});
    expect(port.opened).toBe(true);
    expect(port.openOptions?.baudRate).toBe(DEFAULT_BAUD_RATE);
    expect(states.map((s) => s.kind)).toEqual(['closed', 'opening', 'open']);

    await t.close();
    expect(port.closed).toBe(true);
    expect(states.map((s) => s.kind)).toEqual(['closed', 'opening', 'open', 'closed']);
  });

  it('delivers the current state immediately on subscribe', () => {
    const t = new SerialTransport({ provider: providerFor(new FakeSerialPort()) });
    const seen: ConnState[] = [];
    t.onState((s) => seen.push(s));
    expect(seen).toEqual([{ kind: 'closed' }]);
  });

  it('advertises its id and duplex capability', () => {
    const t = new SerialTransport({ provider: providerFor(new FakeSerialPort()) });
    expect(t.id).toBe('serial');
    expect(t.capabilities.duplex).toBe(true);
  });

  it('rejects a second open while already open', async () => {
    const port = new FakeSerialPort();
    const t = new SerialTransport({ provider: providerFor(port) });
    await t.open({});
    await expect(t.open({})).rejects.toThrow(/already open/);
    await t.close();
  });
});

describe('SerialTransport baud handling', () => {
  it('passes a custom (allowed) baud rate to the port', async () => {
    const port = new FakeSerialPort();
    const t = new SerialTransport({ provider: providerFor(port) });
    await t.open({ baudRate: 57600 });
    expect(port.openOptions?.baudRate).toBe(57600);
    await t.close();
  });

  it('rejects an invalid baud rate without opening', async () => {
    const port = new FakeSerialPort();
    const t = new SerialTransport({ provider: providerFor(port) });
    await expect(t.open({ baudRate: -1 })).rejects.toThrow(/baudRate/);
    expect(port.opened).toBe(false);
  });
});

describe('SerialTransport byte flow + stats', () => {
  it('streams inbound bytes into readable and counts them', async () => {
    const port = new FakeSerialPort();
    const t = new SerialTransport({ provider: providerFor(port) });
    await t.open({});

    const reader = t.readable.getReader();
    port.pushRx(new Uint8Array([1, 2, 3]));
    const first = await reader.read();
    expect(first.value).toEqual(new Uint8Array([1, 2, 3]));

    port.pushRx(new Uint8Array([4, 5]));
    const second = await reader.read();
    expect(second.value).toEqual(new Uint8Array([4, 5]));

    expect(t.stats().bytesIn).toBe(5);
    expect(t.stats().bytesOut).toBe(0);

    reader.releaseLock();
    await t.close();
  });

  it('forwards writes to the port and counts outbound bytes', async () => {
    const port = new FakeSerialPort();
    const t = new SerialTransport({ provider: providerFor(port) });
    await t.open({});

    const writer = t.writable.getWriter();
    await writer.write(new Uint8Array([10, 20, 30, 40]));
    await until(() => port.written.length >= 1, 'outbound chunk to reach port');
    expect(port.written[0]).toEqual(new Uint8Array([10, 20, 30, 40]));

    await writer.write(new Uint8Array([50]));
    await until(() => port.written.length >= 2, 'second outbound chunk');
    expect(t.stats().bytesOut).toBe(5);
    expect(t.stats().bytesIn).toBe(0);

    writer.releaseLock();
    await t.close();
  });

  it('reports a contract-shaped LinkStats with framing fields zeroed', async () => {
    const port = new FakeSerialPort();
    const t = new SerialTransport({ provider: providerFor(port) });
    await t.open({});
    const stats = t.stats();
    expect(stats).toEqual({
      bytesIn: 0,
      bytesOut: 0,
      packetsIn: 0,
      lossPct: 0,
      rateHz: 0,
      signed: false,
    });
    expect('rssi' in stats).toBe(false);
    await t.close();
  });
});

describe('SerialTransport error handling', () => {
  it('errors when no Web Serial provider is available', async () => {
    const t = new SerialTransport(); // no provider; happy-dom has no navigator.serial
    const { states } = collectStates(t);
    await expect(t.open({})).rejects.toThrow(/not supported/);
    expect(states[states.length - 1]).toEqual({
      kind: 'error',
      message: 'Web Serial is not supported in this environment',
    });
  });

  it('transitions to error on a port disconnect (re-plug)', async () => {
    const port = new FakeSerialPort();
    const t = new SerialTransport({ provider: providerFor(port) });
    const { states } = collectStates(t);
    await t.open({});

    port.emitDisconnect();
    expect(states[states.length - 1]).toEqual({
      kind: 'error',
      message: 'serial port disconnected',
    });
  });
});

describe('serial transport factory', () => {
  it('reports supported when a provider is injected', () => {
    const factory = createSerialTransportFactory({ provider: providerFor(new FakeSerialPort()) });
    expect(factory.id).toBe('serial');
    expect(factory.isSupported()).toBe(true);
    expect(factory.configSchema).toBeTruthy();
  });

  it('reports unsupported when navigator.serial is absent', () => {
    // happy-dom provides `navigator` without a `serial` member.
    expect(serialTransportFactory.isSupported()).toBe(false);
    expect(createSerialTransportFactory().isSupported()).toBe(false);
  });

  it('honors an explicit isSupported override', () => {
    expect(createSerialTransportFactory({ isSupported: () => true }).isSupported()).toBe(true);
    expect(createSerialTransportFactory({ isSupported: () => false }).isSupported()).toBe(false);
  });

  it('creates working transports that open via the injected port', async () => {
    const port = new FakeSerialPort();
    const factory = createSerialTransportFactory({ provider: providerFor(port) });
    const t = factory.create();
    await t.open({});
    expect(port.opened).toBe(true);
    await t.close();
    expect(port.closed).toBe(true);
  });

  it('exposes a baud-rate select in its config schema', () => {
    const schema = serialTransportFactory.configSchema as {
      fields: ReadonlyArray<{ key: string; type: string; options: unknown[] }>;
    };
    const baudField = schema.fields.find((f) => f.key === 'baudRate');
    expect(baudField?.type).toBe('select');
    expect((baudField?.options.length ?? 0) > 0).toBe(true);
  });
});
