/**
 * `data/tlog` public surface (task T2.10; spec plan/07 §7.4).
 *
 * Telemetry-log recording: subscribe to the MAVLink host's never-dropped
 * raw-frame tap and append each frame to a Mission-Planner-compatible tlog,
 * chunked into a {@link BlobStore} and exportable as a single blob / saved to
 * disk. The byte format is the exact inverse of `transport/replay`'s
 * `parseTlog`, so a recording round-trips cleanly. See `./README.md`.
 */
export { TlogRecorder } from './recorder';
export {
  TIMESTAMP_BYTES,
  TLOG_MIME,
  concatChunks,
  encodeTlogEntry,
  microsToTlogTicks,
} from './encoder';
export type {
  ConnStateLike,
  RawFrameLike,
  RawFrameSource,
  TlogRecorderOptions,
  TlogSidecar,
  TlogStats,
} from './types';
