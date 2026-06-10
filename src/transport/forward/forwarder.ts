/**
 * MAVLink raw-byte forwarding/proxy service (T8.5; spec plan/03 §3.5).
 *
 * The forwarder is deliberately transport- and stream-based: it never decodes
 * MAVLink frames and therefore preserves raw bytes exactly as received. Its
 * primary path is `source.readable` → every target's `writable`; optional
 * bidirectional mode also copies each target's `readable` → `source.writable`.
 *
 * Back-pressure policy: forwarding must never stall the source reader. Each
 * destination writer has a small bounded queue. When a destination already has
 * `maxPendingChunks` writes queued/in-flight, the newest chunk for that
 * destination is dropped and counted in stats; other destinations continue to
 * receive traffic. This mirrors a proxy tap: a slow secondary link is sacrificed
 * before the primary link is blocked.
 */

import type { Transport } from '../../contracts/transport';

/** Default number of chunks queued per destination before new chunks are dropped. */
const DEFAULT_MAX_PENDING_CHUNKS = 16;

/** A raw byte chunk carried by the frozen transport streams. */
type ByteChunk = Uint8Array;

/** Per-direction counters for accepted and dropped forwarding work. */
export interface ForwardDirectionStats {
  /** Chunks accepted into the destination writer queue. */
  readonly chunksForwarded: number;
  /** Bytes accepted into the destination writer queue. */
  readonly bytesForwarded: number;
  /** Chunks dropped because the destination queue was full or unavailable. */
  readonly chunksDropped: number;
  /** Bytes dropped because the destination queue was full or unavailable. */
  readonly bytesDropped: number;
}

/** Snapshot for one configured target. */
export interface ForwardTargetStats {
  /** Target transport id (not necessarily globally unique). */
  readonly id: string;
  /** Primary direction: source readable → target writable. */
  readonly sourceToTarget: ForwardDirectionStats;
  /** Optional reverse direction: target readable → source writable. */
  readonly targetToSource?: ForwardDirectionStats;
}

/** Forwarder counters and lifecycle state. */
export interface ForwarderStats {
  /** Whether the source read loop has been started and not stopped. */
  readonly running: boolean;
  /** Per-target forwarding counters. */
  readonly targets: readonly ForwardTargetStats[];
}

/** Optional settings for a target added to a forwarder. */
export interface ForwarderTargetOptions {
  /** Enable target readable → source writable forwarding for this target. */
  readonly bidirectional?: boolean;
  /** Override the destination queue bound for this target. */
  readonly maxPendingChunks?: number;
}

/** Options for {@link createForwarder}. */
export interface CreateForwarderOptions {
  /** Primary link whose inbound bytes are rebroadcast to targets. */
  readonly source: Transport;
  /** Initial secondary links. More can be added with {@link MavlinkForwarder.addTarget}. */
  readonly targets?: readonly Transport[];
  /** Default reverse forwarding for targets unless overridden in `addTarget`. */
  readonly bidirectional?: boolean;
  /** Default per-destination queue bound before dropping chunks (default 16). */
  readonly maxPendingChunks?: number;
}

/** Public MAVLink forwarding/proxy API. */
export interface Forwarder {
  /** Start consuming the source stream and forwarding to configured targets. */
  start(): void;
  /** Stop future forwarding. Transports themselves are not closed. */
  stop(): void;
  /** Add a secondary link. If already running, it starts receiving immediately. */
  addTarget(target: Transport, options?: ForwarderTargetOptions): void;
  /** Remove a secondary link by object identity. Returns `true` when removed. */
  removeTarget(target: Transport): boolean;
  /** Current secondary links, in add order. */
  targets(): readonly Transport[];
  /** Current counters, including drops caused by slow destinations. */
  stats(): ForwarderStats;
}

interface MutableDirectionStats {
  chunksForwarded: number;
  bytesForwarded: number;
  chunksDropped: number;
  bytesDropped: number;
}

/** Create a zeroed mutable counter bucket. */
function createDirectionStats(): MutableDirectionStats {
  return { chunksForwarded: 0, bytesForwarded: 0, chunksDropped: 0, bytesDropped: 0 };
}

/** Count an accepted forwarding chunk. */
function recordForwarded(stats: MutableDirectionStats, chunk: ByteChunk): void {
  stats.chunksForwarded += 1;
  stats.bytesForwarded += chunk.byteLength;
}

/** Count a dropped forwarding chunk. */
function recordDropped(stats: MutableDirectionStats, chunk: ByteChunk): void {
  stats.chunksDropped += 1;
  stats.bytesDropped += chunk.byteLength;
}

/** Copy mutable counters into an immutable snapshot shape. */
function directionSnapshot(stats: MutableDirectionStats): ForwardDirectionStats {
  return {
    chunksForwarded: stats.chunksForwarded,
    bytesForwarded: stats.bytesForwarded,
    chunksDropped: stats.chunksDropped,
    bytesDropped: stats.bytesDropped,
  };
}

/** Validate a per-destination queue bound. */
function normalizeMaxPendingChunks(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_PENDING_CHUNKS;
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError('forwarder: maxPendingChunks must be a positive integer');
  }
  return value;
}

/**
 * Destination writer with bounded, non-blocking queueing.
 *
 * `offer()` never awaits the underlying writer. It either schedules the write or
 * records a drop when the queue is full/unavailable.
 */
class DroppingByteSink {
  readonly #writer: WritableStreamDefaultWriter<ByteChunk>;
  readonly #maxPendingChunks: number;
  readonly #stats: MutableDirectionStats;

  #pending = 0;
  #closed = false;
  #tail: Promise<void> = Promise.resolve();
  #stopPromise: Promise<void> | undefined;

  constructor(
    writable: WritableStream<ByteChunk>,
    maxPendingChunks: number,
    stats: MutableDirectionStats = createDirectionStats(),
  ) {
    this.#writer = writable.getWriter();
    this.#maxPendingChunks = maxPendingChunks;
    this.#stats = stats;
  }

  /** Schedule a chunk for writing, or drop it if this destination is too slow. */
  offer(chunk: ByteChunk): boolean {
    if (this.#closed || this.#pending >= this.#maxPendingChunks) {
      this.#recordDrop(chunk);
      return false;
    }

    // Copy so downstream async writes cannot observe caller-side buffer reuse.
    const copy = new Uint8Array(chunk);
    this.#pending += 1;
    recordForwarded(this.#stats, copy);

    const write = this.#tail.then(async () => {
      if (!this.#closed) {
        await this.#writer.write(copy);
      }
    });

    this.#tail = write
      .catch(() => {
        this.#closed = true;
      })
      .finally(() => {
        this.#pending -= 1;
      });

    // Intentionally detached: slow/rejected destinations must not block readers.
    void this.#tail;
    return true;
  }

  /**
   * Stop accepting chunks and release the writer lock after queued work
   * settles. Resolves once the lock has been released, so a restart can wait
   * before re-acquiring the writer (B6).
   */
  stop(): Promise<void> {
    if (this.#stopPromise !== undefined) return this.#stopPromise;
    this.#closed = true;
    this.#stopPromise = this.#tail.finally(() => {
      try {
        this.#writer.releaseLock();
      } catch {
        // The stream may already be errored/closed; there is nothing to close here.
      }
    });
    return this.#stopPromise;
  }

  /** Current immutable counter snapshot. */
  snapshot(): ForwardDirectionStats {
    return directionSnapshot(this.#stats);
  }

  #recordDrop(chunk: ByteChunk): void {
    recordDropped(this.#stats, chunk);
  }
}

/** One read loop over a byte stream. `stop()` is cooperative and non-cancelling. */
class ByteReadLoop {
  readonly #readable: ReadableStream<ByteChunk>;
  readonly #onError: (err: unknown) => void;

  #active = false;
  #reader: ReadableStreamDefaultReader<ByteChunk> | undefined;
  #done: Promise<void> = Promise.resolve();

  constructor(readable: ReadableStream<ByteChunk>, onError: (err: unknown) => void) {
    this.#readable = readable;
    this.#onError = onError;
  }

  /** Acquire the reader lock and begin pumping chunks to `onChunk`. */
  start(onChunk: (chunk: ByteChunk) => void): void {
    if (this.#active) return;
    const reader = this.#readable.getReader();
    this.#reader = reader;
    this.#active = true;
    this.#done = this.#pump(reader, onChunk);
  }

  /**
   * Stop after the current/pending read resolves, without cancelling the source
   * stream or closing any transport. This avoids surprising the link owner.
   * Resolves once the reader lock has been released (B6).
   */
  stop(): Promise<void> {
    this.#active = false;
    return this.#done;
  }

  async #pump(
    reader: ReadableStreamDefaultReader<ByteChunk>,
    onChunk: (chunk: ByteChunk) => void,
  ): Promise<void> {
    try {
      while (this.#active) {
        const result = await reader.read();
        if (!this.#active || result.done) break;
        onChunk(result.value);
      }
    } catch (err) {
      if (this.#active) this.#onError(err);
    } finally {
      this.#active = false;
      if (this.#reader === reader) this.#reader = undefined;
      try {
        reader.releaseLock();
      } catch {
        // If the stream errored while locked, releaseLock can throw; stop is best-effort.
      }
    }
  }
}

class TargetRuntime {
  readonly transport: Transport;
  readonly bidirectional: boolean;
  readonly maxPendingChunks: number;

  readonly #sourceToTargetStats = createDirectionStats();
  #sourceToTarget: DroppingByteSink | undefined;
  #targetToSourceStats: MutableDirectionStats | undefined;
  #reverseLoop: ByteReadLoop | undefined;

  constructor(transport: Transport, options: { bidirectional: boolean; maxPendingChunks: number }) {
    this.transport = transport;
    this.bidirectional = options.bidirectional;
    this.maxPendingChunks = options.maxPendingChunks;
  }

  /** Ensure source → target writes have an active destination writer. */
  startForward(): void {
    if (this.#sourceToTarget !== undefined) return;
    this.#sourceToTarget = new DroppingByteSink(
      this.transport.writable,
      this.maxPendingChunks,
      this.#sourceToTargetStats,
    );
  }

  /** Offer a primary-link chunk to this target. */
  offerFromSource(chunk: ByteChunk): void {
    this.#sourceToTarget?.offer(chunk);
  }

  /** Start optional target → source forwarding. */
  startReverse(sourceSink: DroppingByteSink, onError: (err: unknown) => void): void {
    if (!this.bidirectional || this.#reverseLoop !== undefined) return;
    const reverseStats = this.#targetToSourceStats ?? createDirectionStats();
    this.#targetToSourceStats = reverseStats;
    const loop = new ByteReadLoop(this.transport.readable, onError);
    loop.start((chunk) => {
      if (sourceSink.offer(chunk)) {
        recordForwarded(reverseStats, chunk);
      } else {
        recordDropped(reverseStats, chunk);
      }
    });
    this.#reverseLoop = loop;
  }

  /**
   * Stop this target's forwarding directions; transports remain open.
   * Resolves once all stream locks held by this target are released (B6).
   */
  stop(): Promise<void> {
    const waits: Promise<void>[] = [];
    if (this.#reverseLoop !== undefined) waits.push(this.#reverseLoop.stop());
    this.#reverseLoop = undefined;
    if (this.#sourceToTarget !== undefined) waits.push(this.#sourceToTarget.stop());
    this.#sourceToTarget = undefined;
    return Promise.all(waits).then(() => undefined);
  }

  snapshot(): ForwardTargetStats {
    const sourceToTarget = directionSnapshot(this.#sourceToTargetStats);
    const targetToSource =
      this.#targetToSourceStats === undefined
        ? undefined
        : directionSnapshot(this.#targetToSourceStats);
    if (targetToSource === undefined) {
      return { id: this.transport.id, sourceToTarget };
    }
    return { id: this.transport.id, sourceToTarget, targetToSource };
  }
}

/** Stream-only MAVLink byte forwarder/proxy. */
export class MavlinkForwarder implements Forwarder {
  readonly #source: Transport;
  readonly #defaultBidirectional: boolean;
  readonly #defaultMaxPendingChunks: number;
  readonly #targets = new Map<Transport, TargetRuntime>();
  readonly #sourceLoop: ByteReadLoop;

  #running = false;
  #sourceSink: DroppingByteSink | undefined;
  #lastError: unknown;
  /** Pending lock releases from a prior stop(); a restart waits on this (B6). */
  #releasePending: Promise<void> | undefined;
  /** Bumped on every stop() so a deferred restart can detect it was superseded. */
  #generation = 0;

  constructor(options: CreateForwarderOptions) {
    this.#source = options.source;
    this.#defaultBidirectional = options.bidirectional ?? false;
    this.#defaultMaxPendingChunks = normalizeMaxPendingChunks(options.maxPendingChunks);
    this.#sourceLoop = new ByteReadLoop(this.#source.readable, (err) => {
      this.#lastError = err;
    });

    for (const target of options.targets ?? []) {
      this.addTarget(target);
    }
  }

  /** Start source → target forwarding and any configured reverse loops. */
  start(): void {
    if (this.#running) return;
    this.#running = true;

    const pending = this.#releasePending;
    if (pending === undefined) {
      this.#startLocked();
      return;
    }

    // A prior stop() is still releasing its stream locks; wait for the
    // releases before re-acquiring readers/writers so a quick stop→start
    // cannot throw on locked streams (B6).
    const generation = this.#generation;
    void pending
      .then(() => {
        if (!this.#running || generation !== this.#generation) return;
        this.#releasePending = undefined;
        this.#startLocked();
      })
      .catch((err: unknown) => {
        this.#lastError = err;
        this.stop();
      });
  }

  /** Acquire stream locks and begin pumping. Assumes locks are available. */
  #startLocked(): void {
    try {
      for (const target of this.#targets.values()) {
        target.startForward();
      }
      for (const target of this.#targets.values()) {
        if (target.bidirectional) {
          target.startReverse(this.#getSourceSink(), (err) => {
            this.#lastError = err;
          });
        }
      }
      this.#sourceLoop.start((chunk) => {
        for (const target of this.#targets.values()) {
          target.offerFromSource(chunk);
        }
      });
    } catch (err) {
      this.stop();
      throw err;
    }
  }

  /** Stop forwarding. Stream locks are released cooperatively; transports stay open. */
  stop(): void {
    this.#running = false;
    this.#generation += 1;
    const waits: Promise<void>[] = [this.#sourceLoop.stop()];
    for (const target of this.#targets.values()) {
      waits.push(target.stop());
    }
    if (this.#sourceSink !== undefined) {
      waits.push(this.#sourceSink.stop());
      this.#sourceSink = undefined;
    }
    const prior = this.#releasePending ?? Promise.resolve();
    this.#releasePending = prior.then(() => Promise.all(waits)).then(() => undefined);
  }

  /** Add a secondary transport. */
  addTarget(target: Transport, options: ForwarderTargetOptions = {}): void {
    if (target === this.#source) {
      throw new Error('forwarder: source cannot be added as a target');
    }
    if (this.#targets.has(target)) {
      throw new Error('forwarder: target is already registered');
    }

    const runtime = new TargetRuntime(target, {
      bidirectional: options.bidirectional ?? this.#defaultBidirectional,
      maxPendingChunks: normalizeMaxPendingChunks(
        options.maxPendingChunks ?? this.#defaultMaxPendingChunks,
      ),
    });
    this.#targets.set(target, runtime);

    if (this.#running) {
      try {
        runtime.startForward();
        if (runtime.bidirectional) {
          runtime.startReverse(this.#getSourceSink(), (err) => {
            this.#lastError = err;
          });
        }
      } catch (err) {
        this.#targets.delete(target);
        void runtime.stop();
        throw err;
      }
    }
  }

  /** Remove a secondary transport by object identity. */
  removeTarget(target: Transport): boolean {
    const runtime = this.#targets.get(target);
    if (runtime === undefined) return false;
    void runtime.stop();
    this.#targets.delete(target);
    if (![...this.#targets.values()].some((entry) => entry.bidirectional)) {
      void this.#sourceSink?.stop();
      this.#sourceSink = undefined;
    }
    return true;
  }

  /** Configured secondary transports. */
  targets(): readonly Transport[] {
    return [...this.#targets.keys()];
  }

  /** Current lifecycle and drop/forward counters. */
  stats(): ForwarderStats {
    return {
      running: this.#running,
      targets: [...this.#targets.values()].map((target) => target.snapshot()),
    };
  }

  /** Last stream read error observed by a background loop, if any. */
  lastError(): unknown {
    return this.#lastError;
  }

  #getSourceSink(): DroppingByteSink {
    if (this.#sourceSink === undefined) {
      this.#sourceSink = new DroppingByteSink(this.#source.writable, this.#defaultMaxPendingChunks);
    }
    return this.#sourceSink;
  }
}

/** Create a MAVLink raw-byte forwarder/proxy service. */
export function createForwarder(options: CreateForwarderOptions): Forwarder {
  return new MavlinkForwarder(options);
}
