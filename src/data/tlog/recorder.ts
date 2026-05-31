/**
 * {@link TlogRecorder} — records every received MAVLink frame to a
 * Mission-Planner-compatible tlog (task T2.10; spec plan/07 §7.4).
 *
 * Design — NEVER DROP (spec plan/02 §2.6, plan/07 §7.4): the recording path is
 * fully SYNCHRONOUS at the point of receipt. The {@link RawFrameSource}'s
 * raw-frame tap (a path the host keeps SEPARATE from coalesced telemetry)
 * invokes {@link onFrame}, which encodes the entry and appends it to an in-memory
 * buffer WITHOUT awaiting anything — it can never apply back-pressure to, or be
 * skipped by, the wire/UI. Persistence to the {@link BlobStore} happens off that
 * hot path: once the buffer crosses `chunkBytes` it is handed to a SERIALIZED
 * flush chain (chunks land in receive order) while new frames keep appending to a
 * fresh buffer. Memory is bounded by the flush threshold under normal IDB
 * throughput; a stalled store grows the pending buffer rather than dropping data.
 *
 * Storage layout (M2 default = chunked IndexedDB; streaming to `FileIo` is a
 * documented post-M2 enhancement): within `namespace`, each recording writes
 * `"<id>/<n>"` chunk records in order plus an optional `"<id>/sidecar"` JSON
 * record. {@link export} reassembles the chunks (+ any un-flushed tail) into the
 * full tlog blob; {@link saveAs} writes that blob to disk via {@link FileIo}.
 */
import type { BlobStore, FileIo } from '../../contracts';
import { TLOG_MIME, concatChunks, encodeTlogEntry } from './encoder';
import type {
  ConnStateLike,
  RawFrameLike,
  RawFrameSource,
  TlogRecorderOptions,
  TlogSidecar,
  TlogStats,
} from './types';

/** Default flush threshold: persist a chunk once the buffer reaches 64 KiB. */
const DEFAULT_CHUNK_BYTES = 64 * 1024;
/** Default blob-store namespace for tlog chunks + sidecars. */
const DEFAULT_NAMESPACE = 'tlog';

/** Coerce an unknown thrown value into an `Error`. */
function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Coerce a `Uint8Array` to an `ArrayBuffer`-backed view so it satisfies
 * `BlobPart` under TS6's stricter typed arrays (a `Uint8Array<ArrayBufferLike>`
 * could be `SharedArrayBuffer`-backed). tlog frames are always `ArrayBuffer`-
 * backed at runtime; copy only in the (unreachable here) shared-buffer case.
 */
function asBlobPart(u8: Uint8Array): Uint8Array<ArrayBuffer> {
  if (u8.buffer instanceof ArrayBuffer) return u8 as Uint8Array<ArrayBuffer>;
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return copy;
}

/**
 * Records received frames to a chunked, never-dropped, MP-compatible tlog.
 * Subscribe-on-construct: the recorder taps {@link RawFrameSource.onRawFrame}
 * immediately but only writes between {@link start} and {@link stop}.
 */
export class TlogRecorder {
  private readonly source: RawFrameSource;
  private readonly blobs: BlobStore;
  private readonly fileIo: FileIo | undefined;
  private readonly namespace: string;
  private readonly chunkBytes: number;
  private readonly now: () => number;
  private readonly idFactory: () => string;

  private readonly unsubRaw: () => void;
  private readonly unsubState: (() => void) | undefined;

  private recording = false;
  private recordingId: string | undefined;
  private chunkIndex = 0;
  private readonly chunkKeys: string[] = [];

  /** Encoded entries not yet handed to the flush chain (the never-drop buffer). */
  private pending: Uint8Array[] = [];
  private pendingBytes = 0;

  /** Serializes flushes so chunks persist in receive order. */
  private flushChain: Promise<void> = Promise.resolve();
  /** First flush error, surfaced (not swallowed) by {@link stop}/{@link export}. */
  private flushError: Error | undefined;

  private frameCount = 0;
  private sizeBytes = 0;
  private firstRxTimeUs: number | undefined;
  private lastRxTimeUs: number | undefined;

  private disposed = false;

  constructor(options: TlogRecorderOptions) {
    this.source = options.source;
    this.blobs = options.blobs;
    this.fileIo = options.fileIo;
    this.namespace = options.namespace ?? DEFAULT_NAMESPACE;
    this.chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    this.now = options.now ?? ((): number => Date.now());
    this.idFactory = options.idFactory ?? ((): string => `tlog-${this.now()}`);

    this.unsubRaw = this.source.onRawFrame((frame) => this.onFrame(frame));
    this.unsubState =
      options.autoStartOnConnect && this.source.onState
        ? this.source.onState((s) => this.onState(s))
        : undefined;
  }

  /** Whether a recording is currently in progress. */
  get isRecording(): boolean {
    return this.recording;
  }

  /** Id of the active (or most recent) recording, if any. */
  get currentId(): string | undefined {
    return this.recordingId;
  }

  /**
   * Begin a new recording and return its id. Optionally persists a `sidecar`
   * metadata record. Throws if a recording is already in progress or the
   * recorder has been {@link dispose}d.
   */
  async start(sidecar?: TlogSidecar): Promise<string> {
    if (this.disposed) throw new Error('TlogRecorder disposed');
    if (this.recording) throw new Error('TlogRecorder: already recording');

    const id = this.idFactory();
    this.recordingId = id;
    this.chunkIndex = 0;
    this.chunkKeys.length = 0;
    this.pending = [];
    this.pendingBytes = 0;
    this.frameCount = 0;
    this.sizeBytes = 0;
    this.firstRxTimeUs = undefined;
    this.lastRxTimeUs = undefined;
    this.flushError = undefined;
    this.flushChain = Promise.resolve();
    this.recording = true;

    if (sidecar !== undefined) await this.writeSidecar(id, sidecar);
    return id;
  }

  /**
   * Stop recording, flush the remaining buffer, and wait for all chunk writes to
   * settle. Re-throws the first flush error, if any, so persistence failures are
   * never silent. Safe to call when not recording.
   */
  async stop(): Promise<void> {
    if (!this.recording) return;
    this.recording = false;
    this.flush();
    await this.flushChain;
    if (this.flushError) throw this.flushError;
  }

  /** A point-in-time {@link TlogStats} summary. */
  stats(): TlogStats {
    const durationUs =
      this.firstRxTimeUs !== undefined && this.lastRxTimeUs !== undefined
        ? this.lastRxTimeUs - this.firstRxTimeUs
        : 0;
    return {
      recording: this.recording,
      ...(this.recordingId !== undefined ? { recordingId: this.recordingId } : {}),
      frameCount: this.frameCount,
      sizeBytes: this.sizeBytes,
      durationUs,
    };
  }

  /**
   * Reassemble the full tlog as a single {@link Blob}: every persisted chunk (in
   * receive order) followed by any un-flushed tail captured synchronously at call
   * time. Awaits in-flight flushes first and re-throws a pending flush error.
   * Returns an empty blob when nothing has been recorded.
   */
  async export(): Promise<Blob> {
    const keys = [...this.chunkKeys];
    const tail = this.pending.length > 0 ? concatChunks(this.pending) : undefined;

    await this.flushChain;
    if (this.flushError) throw this.flushError;

    const parts: BlobPart[] = [];
    for (const key of keys) {
      const size = await this.blobs.size(this.namespace, key);
      parts.push(asBlobPart(await this.blobs.getRange(this.namespace, key, 0, size)));
    }
    if (tail !== undefined) parts.push(asBlobPart(tail));
    return new Blob(parts, { type: TLOG_MIME });
  }

  /**
   * Save the full tlog to disk via the injected {@link FileIo}. Throws if no
   * `fileIo` was provided at construction.
   */
  async saveAs(suggestedName?: string): Promise<void> {
    if (this.fileIo === undefined) throw new Error('TlogRecorder: no FileIo provided');
    const blob = await this.export();
    const name = suggestedName ?? `${this.recordingId ?? 'recording'}.tlog`;
    await this.fileIo.saveAs(blob, name);
  }

  /**
   * Tear down: unsubscribe the taps and stop recording. Idempotent. Awaits a
   * final flush so no buffered frames are lost on teardown.
   */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubRaw();
    this.unsubState?.();
    if (this.recording) {
      this.recording = false;
      this.flush();
      await this.flushChain;
    }
  }

  // --- hot path (synchronous, never drops) --------------------------------

  /** Encode + append one frame. Synchronous; never awaits, never drops. */
  private onFrame(frame: RawFrameLike): void {
    if (!this.recording) return;
    const entry = encodeTlogEntry(frame.rxTimeUs, frame.raw);
    this.pending.push(entry);
    this.pendingBytes += entry.byteLength;
    this.frameCount += 1;
    this.sizeBytes += entry.byteLength;
    if (this.firstRxTimeUs === undefined) this.firstRxTimeUs = frame.rxTimeUs;
    this.lastRxTimeUs = frame.rxTimeUs;
    if (this.pendingBytes >= this.chunkBytes) this.flush();
  }

  /** Auto-start-on-connect bridge: start on `open`, stop on `closed`/`error`. */
  private onState(state: ConnStateLike): void {
    if (this.disposed) return;
    if (state.kind === 'open') {
      if (!this.recording) void this.start();
    } else if (state.kind === 'closed' || state.kind === 'error') {
      if (this.recording) void this.stop();
    }
  }

  // --- persistence (off the hot path) -------------------------------------

  /**
   * Hand the current buffer to the serialized flush chain as one chunk. The
   * chunk key + order are assigned SYNCHRONOUSLY (so receive order is fixed even
   * though the write resolves later); the buffer is reset immediately so new
   * frames accumulate independently.
   */
  private flush(): void {
    if (this.pending.length === 0) return;
    const chunk = concatChunks(this.pending);
    this.pending = [];
    this.pendingBytes = 0;

    const id = this.recordingId;
    if (id === undefined) return;
    const key = `${id}/${this.chunkIndex}`;
    this.chunkIndex += 1;
    this.chunkKeys.push(key);

    this.flushChain = this.flushChain
      .then(() =>
        this.blobs.put(this.namespace, key, new Blob([asBlobPart(chunk)], { type: TLOG_MIME })),
      )
      .catch((err: unknown) => {
        this.flushError ??= asError(err);
      });
  }

  /** Persist the optional sidecar JSON as a separate `"<id>/sidecar"` record. */
  private async writeSidecar(id: string, sidecar: TlogSidecar): Promise<void> {
    const enriched: TlogSidecar = { startedAtMs: this.now(), ...sidecar };
    const json = JSON.stringify(enriched);
    await this.blobs.put(
      this.namespace,
      `${id}/sidecar`,
      new Blob([json], { type: 'application/json' }),
      enriched,
    );
  }
}
