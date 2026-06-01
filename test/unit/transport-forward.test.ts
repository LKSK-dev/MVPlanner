import { describe, expect, it } from 'vitest';
import type { ConnState, LinkStats, Transport } from '../../src/contracts/transport';
import { createForwarder } from '../../src/transport/forward';

/** Resolve after Web Stream promise continuations have had a chance to run. */
async function flushMicrotasks(cycles = 8): Promise<void> {
  for (let i = 0; i < cycles; i++) {
    await Promise.resolve();
  }
}

/** In-memory transport whose readable can be fed and whose writable records bytes. */
class FakeTransport implements Transport {
  readonly id: string;
  readonly capabilities = { duplex: true, reconnect: false } as const;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;

  readonly writes: Uint8Array<ArrayBuffer>[] = [];

  readonly #inputWriter: WritableStreamDefaultWriter<Uint8Array>;
  readonly #slowResolvers: Array<() => void> = [];
  readonly #slow: boolean;
  readonly #listeners = new Set<(s: ConnState) => void>();

  #state: ConnState = { kind: 'closed' };

  constructor(id: string, options: { slow?: boolean } = {}) {
    this.id = id;
    this.#slow = options.slow ?? false;

    const inbound = new TransformStream<Uint8Array, Uint8Array>();
    this.readable = inbound.readable;
    this.#inputWriter = inbound.writable.getWriter();

    this.writable = new WritableStream<Uint8Array>({
      write: (chunk): void | Promise<void> => {
        this.writes.push(new Uint8Array(chunk));
        if (!this.#slow) return;
        return new Promise<void>((resolve) => {
          this.#slowResolvers.push(resolve);
        });
      },
    });
  }

  async open(_config: unknown): Promise<void> {
    this.#setState({ kind: 'open' });
  }

  async close(): Promise<void> {
    this.#setState({ kind: 'closed' });
  }

  onState(cb: (s: ConnState) => void): () => void {
    this.#listeners.add(cb);
    cb(this.#state);
    return () => {
      this.#listeners.delete(cb);
    };
  }

  stats(): LinkStats {
    const bytesOut = this.writes.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    return { bytesIn: 0, bytesOut, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false };
  }

  /** Emit inbound bytes on this transport's readable stream. */
  async emit(bytes: readonly number[]): Promise<void> {
    await this.#inputWriter.write(new Uint8Array(bytes));
  }

  /** Resolve one intentionally slow write. */
  releaseOneSlowWrite(): void {
    const resolve = this.#slowResolvers.shift();
    resolve?.();
  }

  /** Number of underlying slow writes currently unresolved. */
  pendingSlowWrites(): number {
    return this.#slowResolvers.length;
  }

  #setState(state: ConnState): void {
    this.#state = state;
    for (const cb of this.#listeners) cb(state);
  }
}

function writeValues(transport: FakeTransport): number[][] {
  return transport.writes.map((chunk) => [...chunk]);
}

describe('MAVLink raw-byte forwarder', () => {
  it('writes bytes from the source to all targets', async () => {
    const source = new FakeTransport('source');
    const targetA = new FakeTransport('target-a');
    const targetB = new FakeTransport('target-b');
    const forwarder = createForwarder({ source, targets: [targetA, targetB] });

    forwarder.start();
    await source.emit([1, 2, 3]);
    await flushMicrotasks();

    expect(writeValues(targetA)).toEqual([[1, 2, 3]]);
    expect(writeValues(targetB)).toEqual([[1, 2, 3]]);
    expect(forwarder.stats().targets.map((target) => target.sourceToTarget)).toEqual([
      { chunksForwarded: 1, bytesForwarded: 3, chunksDropped: 0, bytesDropped: 0 },
      { chunksForwarded: 1, bytesForwarded: 3, chunksDropped: 0, bytesDropped: 0 },
    ]);
  });

  it('supports adding and removing targets while running', async () => {
    const source = new FakeTransport('source');
    const targetA = new FakeTransport('target-a');
    const targetB = new FakeTransport('target-b');
    const forwarder = createForwarder({ source });

    forwarder.start();
    await source.emit([0]);
    await flushMicrotasks();
    expect(forwarder.targets()).toEqual([]);

    forwarder.addTarget(targetA);
    await source.emit([1]);
    await flushMicrotasks();
    expect(writeValues(targetA)).toEqual([[1]]);

    forwarder.addTarget(targetB);
    await source.emit([2]);
    await flushMicrotasks();
    expect(writeValues(targetA)).toEqual([[1], [2]]);
    expect(writeValues(targetB)).toEqual([[2]]);

    expect(forwarder.removeTarget(targetA)).toBe(true);
    await source.emit([3]);
    await flushMicrotasks();
    expect(writeValues(targetA)).toEqual([[1], [2]]);
    expect(writeValues(targetB)).toEqual([[2], [3]]);
  });

  it('can forward bidirectionally from targets back to the source writable', async () => {
    const source = new FakeTransport('source');
    const targetA = new FakeTransport('target-a');
    const targetB = new FakeTransport('target-b');
    const forwarder = createForwarder({ source, targets: [targetA, targetB], bidirectional: true });

    forwarder.start();
    await source.emit([1, 2]);
    await targetA.emit([9]);
    await targetB.emit([8, 7]);
    await flushMicrotasks();

    expect(writeValues(targetA)).toEqual([[1, 2]]);
    expect(writeValues(targetB)).toEqual([[1, 2]]);
    expect(writeValues(source)).toEqual([[9], [8, 7]]);

    const stats = forwarder.stats().targets;
    expect(stats[0]?.targetToSource).toEqual({
      chunksForwarded: 1,
      bytesForwarded: 1,
      chunksDropped: 0,
      bytesDropped: 0,
    });
    expect(stats[1]?.targetToSource).toEqual({
      chunksForwarded: 1,
      bytesForwarded: 2,
      chunksDropped: 0,
      bytesDropped: 0,
    });
  });

  it('stop() halts forwarding without closing transports', async () => {
    const source = new FakeTransport('source');
    const target = new FakeTransport('target');
    const forwarder = createForwarder({ source, targets: [target] });

    forwarder.start();
    await source.emit([1]);
    await flushMicrotasks();
    forwarder.stop();

    await source.emit([2]);
    await flushMicrotasks();

    expect(writeValues(target)).toEqual([[1]]);
    expect(forwarder.stats().running).toBe(false);
    await expect(source.open(undefined)).resolves.toBeUndefined();
    await expect(target.open(undefined)).resolves.toBeUndefined();
  });

  it('drops chunks to a slow target instead of stalling the source or fast targets', async () => {
    const source = new FakeTransport('source');
    const fast = new FakeTransport('fast');
    const slow = new FakeTransport('slow', { slow: true });
    const forwarder = createForwarder({ source, targets: [fast] });
    forwarder.addTarget(slow, { maxPendingChunks: 1 });

    forwarder.start();
    await source.emit([1]);
    await source.emit([2]);
    await source.emit([3]);
    await flushMicrotasks();

    expect(writeValues(fast)).toEqual([[1], [2], [3]]);
    expect(writeValues(slow)).toEqual([[1]]);
    expect(slow.pendingSlowWrites()).toBe(1);

    const slowStats = forwarder.stats().targets.find((target) => target.id === 'slow');
    expect(slowStats?.sourceToTarget).toEqual({
      chunksForwarded: 1,
      bytesForwarded: 1,
      chunksDropped: 2,
      bytesDropped: 2,
    });

    slow.releaseOneSlowWrite();
  });
});
