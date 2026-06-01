/**
 * Playback controller seam (task T6.6; spec plan/04 §4.7, plan/03 §3.5 item 6).
 *
 * The {@link import('./playback').PlaybackControls} component never talks to a
 * {@link import('../../../../transport/replay').ReplayTransport} directly. It
 * drives the abstract {@link PlaybackController} — a small command surface
 * (play/pause/step/seek/setSpeed) plus a {@link PlaybackProgress} subscription —
 * so the UI is unit-testable against a lightweight mock and the actual transport
 * wiring is injected.
 *
 * {@link createReplayController} adapts a real `ReplayTransport`'s additive
 * playback methods (`resume`/`pause`/`step`/`seek`/`setSpeed`) to this seam, and
 * {@link openTlog} parses a tlog's duration and opens the transport so the Logs
 * assembly (T6.8) can hand the resulting controller to the control bar and feed
 * live positions back via {@link ReplayController.report}.
 */

import { parseTlog } from '../../../../transport/replay';
import type { FileIo } from '../../../../contracts';

/** A progress report emitted as replay advances (consumed by the UI). */
export interface PlaybackProgress {
  /** Current playback position in microseconds from the start of the log. */
  readonly positionUs: number;
  /** Total log duration in microseconds (0 when not yet known). */
  readonly totalUs: number;
  /** True once playback reaches the end of the log. */
  readonly ended: boolean;
}

/** The minimal command + subscription surface the control bar drives. */
export interface PlaybackController {
  /** Resume / start playback. */
  play(): void;
  /** Pause playback, leaving the position untouched. */
  pause(): void;
  /** Emit exactly one frame and pause. */
  step(): void;
  /** Jump to `timeUs` (relative microseconds from the log start). */
  seek(timeUs: number): void;
  /** Set the playback speed multiplier (0.1×–32×). */
  setSpeed(speed: number): void;
  /** Subscribe to progress updates; returns an unsubscribe function. */
  subscribe(listener: (progress: PlaybackProgress) => void): () => void;
}

/**
 * The subset of `ReplayTransport`'s additive playback methods the controller
 * maps onto. Declared structurally so the adapter needs no Worker/DOM import and
 * tests can pass a plain spy object.
 */
export interface ReplayPlaybackTransport {
  /** Resume the replay clock. */
  resume(): void;
  /** Stop the replay clock; the pending frame stays queued. */
  pause(): void;
  /** Emit exactly one frame immediately, then pause. */
  step(): void;
  /** Jump to the first frame at/after `timeUs` (relative microseconds). */
  seek(timeUs: number): void;
  /** Scale inter-frame delays by `n` (0.1×–32×). */
  setSpeed(n: number): void;
}

/** A {@link ReplayPlaybackTransport} that can also be opened with tlog bytes. */
export interface OpenableReplayTransport extends ReplayPlaybackTransport {
  /** Open the transport with the tlog bytes (mirrors `ReplayTransport.open`). */
  open(config: { data: ArrayBuffer | Uint8Array; speed?: number }): Promise<void>;
}

/** A {@link PlaybackController} that also accepts live position reports. */
export interface ReplayController extends PlaybackController {
  /**
   * Push a live progress update to all subscribers. The Logs assembly (T6.8)
   * calls this as it observes replayed frame timestamps so the scrub slider and
   * time readout track playback.
   */
  report(positionUs: number, ended?: boolean): void;
}

/** Clamp `n` into `[0, totalUs]`; non-finite inputs collapse to `0`. */
function clampPosition(n: number, totalUs: number): number {
  if (!Number.isFinite(n) || n < 0) return 0;
  const hi = Math.max(0, totalUs);
  return n > hi ? hi : n;
}

/**
 * Adapt a {@link ReplayPlaybackTransport} to the {@link ReplayController} seam.
 *
 * Command verbs forward to the transport; `seek` also synthesizes an immediate
 * progress report so the UI reflects the jump even before the next frame fires.
 * `report` is the live-position channel the wiring drives. All progress values
 * are clamped to `[0, totalUs]`.
 */
export function createReplayController(
  transport: ReplayPlaybackTransport,
  totalUs: number,
): ReplayController {
  const listeners = new Set<(p: PlaybackProgress) => void>();
  const total = Math.max(0, Number.isFinite(totalUs) ? totalUs : 0);

  const emit = (positionUs: number, ended: boolean): void => {
    const progress: PlaybackProgress = {
      positionUs: clampPosition(positionUs, total),
      totalUs: total,
      ended,
    };
    for (const listener of listeners) listener(progress);
  };

  return {
    play(): void {
      transport.resume();
    },
    pause(): void {
      transport.pause();
    },
    step(): void {
      transport.step();
    },
    seek(timeUs: number): void {
      const target = clampPosition(timeUs, total);
      transport.seek(target);
      emit(target, total > 0 && target >= total);
    },
    setSpeed(speed: number): void {
      transport.setSpeed(speed);
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    report(positionUs, ended = false): void {
      emit(positionUs, ended);
    },
  };
}

/** Total playable duration of a tlog in microseconds (0 for an empty log). */
export function tlogTotalUs(data: ArrayBuffer | Uint8Array): number {
  const frames = parseTlog(data);
  const last = frames[frames.length - 1];
  return last === undefined ? 0 : last.timeUs;
}

/** Options for {@link openTlog}. */
export interface OpenTlogOptions {
  /** The tlog bytes to replay. */
  data: ArrayBuffer | Uint8Array;
  /** An openable replay transport (e.g. a `ReplayTransport` instance). */
  transport: OpenableReplayTransport;
  /** Initial playback speed multiplier (default 1). */
  speed?: number;
  /**
   * Pause the transport immediately after opening so the UI starts paused and
   * the operator presses play. Defaults to `true` (the transport otherwise
   * auto-starts its clock on `open`).
   */
  startPaused?: boolean;
}

/**
 * Open a tlog on an injected replay transport and return a {@link
 * ReplayController} for it. Computes the log duration up front (so the scrub
 * slider has a range) and, by default, pauses immediately after opening.
 */
export async function openTlog(opts: OpenTlogOptions): Promise<ReplayController> {
  const { data, transport, speed, startPaused = true } = opts;
  const totalUs = tlogTotalUs(data);
  await transport.open(speed === undefined ? { data } : { data, speed });
  if (startPaused) transport.pause();
  return createReplayController(transport, totalUs);
}

/**
 * Read tlog bytes from an injected {@link FileIo} file picker. Returns the bytes
 * and the chosen file name, or `undefined` when the user cancels. The Logs
 * assembly passes the bytes to {@link openTlog}.
 */
export async function loadTlogBytes(
  fileIo: FileIo,
  accept: string[] = ['.tlog'],
): Promise<{ name: string; data: ArrayBuffer } | undefined> {
  const picked = await fileIo.openForRead(accept);
  if (picked === undefined) return undefined;
  const data = await picked.blob.arrayBuffer();
  return { name: picked.name, data };
}
