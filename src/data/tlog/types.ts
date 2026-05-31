/**
 * Public types for the tlog recorder (task T2.10; spec plan/07 §7.4).
 *
 * The recorder consumes frames through STRUCTURAL injected seams (not concrete
 * classes) so it stays decoupled from the MAVLink host and trivially testable:
 *
 *  - {@link RawFrameLike} mirrors the host's per-frame `RawFrame` projection
 *    (`{ raw, rxTimeUs, sysid, compid, msgId }`) — only `raw` + `rxTimeUs` are
 *    actually written to the tlog; the routing fields are accepted for parity
 *    and possible future sidecar indexing.
 *  - {@link RawFrameSource} is the minimal slice of `MavlinkHost` the recorder
 *    needs: a never-dropped raw-frame tap, plus an OPTIONAL connection-state tap
 *    used only for auto-start-on-connect.
 */
import type { BlobStore, FileIo } from '../../contracts';

/**
 * One received MAVLink frame, structurally compatible with the host's
 * `RawFrame`. Only {@link raw} and {@link rxTimeUs} are persisted to the tlog.
 */
export interface RawFrameLike {
  /** Raw frame bytes exactly as parsed off the wire (v1/v2, incl. signature). */
  readonly raw: Uint8Array;
  /** Receive time in MICROSECONDS (converted to 100 ns ticks on write). */
  readonly rxTimeUs: number;
  /** Source system id (not persisted; accepted for parity). */
  readonly sysid: number;
  /** Source component id (not persisted; accepted for parity). */
  readonly compid: number;
  /** Decoded message id (not persisted; accepted for parity). */
  readonly msgId: number;
}

/** Minimal connection-state shape for auto-start-on-connect (`{ kind }`). */
export interface ConnStateLike {
  readonly kind: string;
}

/**
 * The minimal host slice the recorder depends on. `MavlinkHost` satisfies this
 * structurally: it exposes a never-dropped {@link onRawFrame} tap and an
 * {@link onState} connection-state tap.
 */
export interface RawFrameSource {
  /** Subscribe to EVERY parsed frame; returns an unsubscribe function. */
  onRawFrame(cb: (frame: RawFrameLike) => void): () => void;
  /**
   * Subscribe to connection-state transitions; returns an unsubscribe function.
   * Optional: only consulted when `autoStartOnConnect` is enabled.
   */
  onState?(cb: (state: ConnStateLike) => void): () => void;
}

/**
 * Optional sidecar metadata persisted alongside a recording as a SEPARATE record
 * (spec plan/07 §7.4). Free-form beyond the documented hints; serialized as JSON.
 */
export interface TlogSidecar {
  /** Vehicle type / autopilot label (e.g. `"ArduCopter"`). */
  readonly vehicleType?: string;
  /** Wall-clock start time as an epoch-millisecond value. */
  readonly startedAtMs?: number;
  /** App / dialect versions or any other notes the caller wants retained. */
  readonly [key: string]: unknown;
}

/** Construction options for {@link import('./recorder').TlogRecorder}. */
export interface TlogRecorderOptions {
  /** The raw-frame source (the MAVLink host). */
  readonly source: RawFrameSource;
  /** Blob store used for chunked, never-dropped persistence. */
  readonly blobs: BlobStore;
  /** Optional disk save target (`saveAs`). */
  readonly fileIo?: FileIo;
  /** Blob-store namespace for chunks + sidecars (default `"tlog"`). */
  readonly namespace?: string;
  /** Flush threshold in bytes: buffer is persisted once it reaches this (default 64 KiB). */
  readonly chunkBytes?: number;
  /** When true, recording starts on `open` and stops on `closed`/`error`. */
  readonly autoStartOnConnect?: boolean;
  /** Injectable wall clock (ms); default `Date.now`. */
  readonly now?: () => number;
  /** Injectable recording-id factory; default a timestamp-based id. */
  readonly idFactory?: () => string;
}

/** A point-in-time summary of the active/last recording. */
export interface TlogStats {
  /** Whether a recording is currently in progress. */
  readonly recording: boolean;
  /** Id of the active (or most recent) recording, if any. */
  readonly recordingId?: string;
  /** Number of frames recorded so far. */
  readonly frameCount: number;
  /** Total tlog size in bytes (timestamp prefixes + frame bytes). */
  readonly sizeBytes: number;
  /** Span between the first and last frame's receive time, in microseconds. */
  readonly durationUs: number;
}
