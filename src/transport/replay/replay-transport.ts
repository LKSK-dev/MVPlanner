/**
 * Replay transport (spec plan/03 §3.5 item 6; plan/07 §7.4).
 *
 * Feeds a recorded tlog back through the byte pipeline so playback exercises the
 * exact same MAVLink stack as a live link. The {@link Transport.readable} stream
 * emits each frame's raw bytes scheduled by the delta between consecutive tlog
 * timestamps divided by the playback speed. The {@link Transport.writable}
 * stream is a no-op sink: replay is one-way, so writes are discarded.
 *
 * Implements the frozen `Transport` contract exactly. The playback control
 * methods (`seek`/`setSpeed`/`pause`/`resume`/`step`) are additive members on
 * this concrete class and do not change the contract; the connection/playback
 * UI (T6.6) drives them on the factory-created instance.
 */

import type { ConnState, LinkStats, Transport } from '../../contracts/transport';
import { parseTlog, type TlogFrame } from './tlog-parser';
import { defaultScheduler, type Scheduler, type TimeoutHandle } from './scheduler';

/** Configuration accepted by {@link ReplayTransport.open}. */
export interface ReplayConfig {
  /** The recorded tlog bytes to replay. */
  data: ArrayBuffer | Uint8Array;
  /** Playback speed multiplier (>0, default 1). 2 = twice as fast. */
  speed?: number;
}

/** Construction options for {@link ReplayTransport}. */
export interface ReplayTransportOptions {
  /** Timer source; defaults to the ambient scheduler. Injected by tests. */
  scheduler?: Scheduler;
}

/** Number of microseconds per millisecond. */
const US_PER_MS = 1000;

/**
 * Validate and normalize an unknown `open()` config into a concrete shape.
 * Throws `TypeError`/`RangeError` rather than failing silently.
 */
function parseReplayConfig(config: unknown): { data: ArrayBuffer | Uint8Array; speed: number } {
  if (typeof config !== 'object' || config === null) {
    throw new TypeError('replay transport: open(config) requires an object');
  }
  const { data, speed } = config as { data?: unknown; speed?: unknown };
  if (!(data instanceof ArrayBuffer) && !(data instanceof Uint8Array)) {
    throw new TypeError('replay transport: config.data must be an ArrayBuffer or Uint8Array');
  }
  let normalizedSpeed = 1;
  if (speed !== undefined) {
    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed <= 0) {
      throw new RangeError('replay transport: config.speed must be a positive finite number');
    }
    normalizedSpeed = speed;
  }
  return { data, speed: normalizedSpeed };
}

export class ReplayTransport implements Transport {
  readonly id = 'replay';
  readonly capabilities = { duplex: false, reconnect: false } as const;
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;

  private readonly scheduler: Scheduler;
  private readonly listeners = new Set<(s: ConnState) => void>();
  private state: ConnState = { kind: 'closed' };

  private controller: ReadableStreamDefaultController<Uint8Array> | undefined;
  private controllerClosed = false;

  private frames: TlogFrame[] = [];
  private index = 0;
  private speed = 1;
  private paused = false;
  private closed = true;
  private timer: TimeoutHandle | undefined;
  /** timeUs of the most recently emitted frame, or undefined if none yet. */
  private lastEmittedTimeUs: number | undefined;

  private bytesIn = 0;
  private packetsIn = 0;

  constructor(options?: ReplayTransportOptions) {
    this.scheduler = options?.scheduler ?? defaultScheduler;

    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.controller = controller;
      },
      cancel: () => {
        this.controllerClosed = true;
        void this.close();
      },
    });

    // One-way transport: discard everything written to the link.
    this.writable = new WritableStream<Uint8Array>({
      write: () => {
        /* discard: replay is read-only */
      },
    });
  }

  // --- Transport contract -------------------------------------------------

  async open(config: unknown): Promise<void> {
    if (this.controllerClosed) {
      throw new Error('transport already consumed; create a new instance');
    }
    if (!this.closed) {
      throw new Error('replay transport: already open');
    }
    const { data, speed } = parseReplayConfig(config);
    this.frames = parseTlog(data);
    this.speed = speed;
    this.index = 0;
    this.lastEmittedTimeUs = undefined;
    this.paused = false;
    this.closed = false;
    this.bytesIn = 0;
    this.packetsIn = 0;

    this.setState({ kind: 'opening' });
    this.setState({ kind: 'open' });
    this.scheduleNext();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    this.closeStream();
    this.setState({ kind: 'closed' });
  }

  /** Subscribe to {@link ConnState}; emits the current state immediately. */
  onState(cb: (s: ConnState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => {
      this.listeners.delete(cb);
    };
  }

  stats(): LinkStats {
    return {
      bytesIn: this.bytesIn,
      bytesOut: 0,
      packetsIn: this.packetsIn,
      lossPct: 0,
      rateHz: 0,
      signed: false,
    };
  }

  // --- Playback controls (additive; not part of the contract) -------------

  /** Set the playback speed multiplier (>0). Applies to the current gap. */
  setSpeed(n: number): void {
    if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) {
      throw new RangeError('replay transport: speed must be a positive finite number');
    }
    this.speed = n;
    if (!this.paused && !this.closed && this.timer !== undefined) {
      this.clearTimer();
      this.scheduleNext();
    }
  }

  /** Pause playback; the pending frame stays queued until {@link resume}. */
  pause(): void {
    if (this.paused || this.closed) return;
    this.paused = true;
    this.clearTimer();
  }

  /** Resume playback from the current position. */
  resume(): void {
    if (!this.paused || this.closed) return;
    this.paused = false;
    this.scheduleNext();
  }

  /**
   * Jump to the first frame at or after `timeUs` (relative microseconds from the
   * start of the tlog). The target frame is emitted immediately; subsequent
   * frames resume normal inter-frame spacing.
   */
  seek(timeUs: number): void {
    if (this.closed) return;
    this.clearTimer();
    const target = timeUs > 0 ? timeUs : 0;
    let i = 0;
    for (; i < this.frames.length; i++) {
      const frame = this.frames[i];
      if (frame === undefined || frame.timeUs >= target) break;
    }
    this.index = i;
    this.lastEmittedTimeUs = undefined; // next frame emits immediately.
    if (!this.paused) this.scheduleNext();
  }

  /** Emit exactly one frame immediately and pause. */
  step(): void {
    if (this.closed) return;
    this.clearTimer();
    this.paused = true;
    const frame = this.frames[this.index];
    if (frame === undefined) {
      this.endOfStream();
      return;
    }
    this.enqueue(frame.bytes);
    this.lastEmittedTimeUs = frame.timeUs;
    this.index += 1;
    if (this.index >= this.frames.length) this.endOfStream();
  }

  // --- Internal scheduling ------------------------------------------------

  private scheduleNext(): void {
    if (this.closed || this.paused) return;
    if (this.index >= this.frames.length) {
      this.endOfStream();
      return;
    }
    const frame = this.frames[this.index];
    if (frame === undefined) {
      this.endOfStream();
      return;
    }
    let delayMs = 0;
    if (this.lastEmittedTimeUs !== undefined) {
      const deltaUs = frame.timeUs - this.lastEmittedTimeUs;
      const clampedUs = deltaUs > 0 ? deltaUs : 0;
      delayMs = clampedUs / US_PER_MS / this.speed;
    }
    this.timer = this.scheduler.setTimeout(() => {
      this.timer = undefined;
      this.emitCurrent();
    }, delayMs);
  }

  private emitCurrent(): void {
    if (this.closed) return;
    const frame = this.frames[this.index];
    if (frame === undefined) {
      this.endOfStream();
      return;
    }
    this.enqueue(frame.bytes);
    this.lastEmittedTimeUs = frame.timeUs;
    this.index += 1;
    if (this.index >= this.frames.length) {
      this.endOfStream();
      return;
    }
    this.scheduleNext();
  }

  private enqueue(bytes: Uint8Array): void {
    if (this.closed || this.controllerClosed || this.controller === undefined) return;
    const chunk = bytes.slice(); // copy: detach from the shared source buffer.
    this.controller.enqueue(chunk);
    this.bytesIn += chunk.byteLength;
    this.packetsIn += 1;
  }

  private endOfStream(): void {
    if (this.closed) return;
    this.closed = true;
    this.clearTimer();
    this.closeStream();
    this.setState({ kind: 'closed' });
  }

  private closeStream(): void {
    if (this.controllerClosed || this.controller === undefined) return;
    this.controllerClosed = true;
    this.controller.close();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      this.scheduler.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private setState(next: ConnState): void {
    this.state = next;
    for (const cb of this.listeners) cb(next);
  }
}
