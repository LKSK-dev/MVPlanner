/**
 * tlog playback logic tests (task T6.6; spec plan/04 §4.7/§4.8).
 *
 * Exercises the PURE timeline state machine, the preset definitions + field-spec
 * mapping, and the `ReplayController` adapter / open helpers against MOCK
 * transports — no Solid, DOM, or real Worker.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  PLAYBACK_SPEEDS,
  clampPosition,
  clampSpeed,
  formatTimecode,
  initialTimeline,
  pause,
  play,
  seek,
  setSpeed,
  stepped,
  togglePlay,
  withProgress,
  withTotal,
} from '../../src/ui/screens/logs/playback/timeline';
import {
  ANALYSIS_PRESETS,
  getPreset,
  presetFieldSpec,
} from '../../src/ui/screens/logs/playback/presets';
import {
  createReplayController,
  loadTlogBytes,
  openTlog,
  tlogTotalUs,
  type OpenableReplayTransport,
  type PlaybackProgress,
  type ReplayPlaybackTransport,
} from '../../src/ui/screens/logs/playback/controller';
import type { FileIo } from '../../src/contracts';

// --- helpers ---------------------------------------------------------------

/** A minimal valid MAVLink v1 frame of `payloadLen` payload bytes. */
function v1Frame(payloadLen: number): Uint8Array {
  const f = new Uint8Array(payloadLen + 8);
  f[0] = 0xfe;
  f[1] = payloadLen;
  return f;
}

/** Assemble a tlog from `[ticks, frame]` entries (u64 BE ticks + raw frame). */
function buildTlog(entries: ReadonlyArray<{ ticks: bigint; frame: Uint8Array }>): Uint8Array {
  const total = entries.reduce((n, e) => n + 8 + e.frame.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let pos = 0;
  for (const e of entries) {
    view.setBigUint64(pos, e.ticks, false);
    pos += 8;
    out.set(e.frame, pos);
    pos += e.frame.length;
  }
  return out;
}

/** A 5-second, two-frame tlog (ticks are 100 ns; 10 ticks = 1 µs). */
const TLOG_5S = buildTlog([
  { ticks: 0n, frame: v1Frame(4) },
  { ticks: 50_000_000n, frame: v1Frame(4) },
]);

function makeTransport(): {
  transport: ReplayPlaybackTransport;
  resume: ReturnType<typeof vi.fn>;
  paused: ReturnType<typeof vi.fn>;
  step: ReturnType<typeof vi.fn>;
  seek: ReturnType<typeof vi.fn>;
  setSpeed: ReturnType<typeof vi.fn>;
} {
  const resume = vi.fn<() => void>();
  const paused = vi.fn<() => void>();
  const step = vi.fn<() => void>();
  const seekFn = vi.fn<(t: number) => void>();
  const setSpeedFn = vi.fn<(n: number) => void>();
  return {
    transport: { resume, pause: paused, step, seek: seekFn, setSpeed: setSpeedFn },
    resume,
    paused,
    step,
    seek: seekFn,
    setSpeed: setSpeedFn,
  };
}

// --- timeline --------------------------------------------------------------

describe('playback timeline (pure)', () => {
  it('starts paused at position 0', () => {
    const s = initialTimeline(5_000_000);
    expect(s).toEqual({
      totalUs: 5_000_000,
      positionUs: 0,
      playing: false,
      speed: 1,
      ended: false,
    });
  });

  it('toggles play/pause', () => {
    const s0 = initialTimeline(1_000);
    const s1 = togglePlay(s0);
    expect(s1.playing).toBe(true);
    expect(togglePlay(s1).playing).toBe(false);
    expect(play(s0).playing).toBe(true);
    expect(pause(s1).playing).toBe(false);
  });

  it('clamps speed into 0.1x..32x and snaps requests', () => {
    expect(clampSpeed(0.01)).toBe(0.1);
    expect(clampSpeed(1000)).toBe(32);
    expect(clampSpeed(4)).toBe(4);
    expect(setSpeed(initialTimeline(1), 8).speed).toBe(8);
    expect(PLAYBACK_SPEEDS).toContain(0.1);
    expect(PLAYBACK_SPEEDS).toContain(32);
  });

  it('clamps seek into [0, totalUs] and tracks the ended flag', () => {
    const s = withTotal(initialTimeline(), 10_000_000);
    expect(clampPosition(-5, 10)).toBe(0);
    expect(seek(s, -1).positionUs).toBe(0);
    expect(seek(s, 4_000_000).positionUs).toBe(4_000_000);
    const end = seek(s, 99_000_000);
    expect(end.positionUs).toBe(10_000_000);
    expect(end.ended).toBe(true);
    // seeking back from the end clears `ended`.
    expect(seek(end, 1_000_000).ended).toBe(false);
  });

  it('step always leaves playback paused', () => {
    const playing = play(initialTimeline(1_000));
    expect(stepped(playing).playing).toBe(false);
  });

  it('folds controller progress (position/total/ended) into the timeline', () => {
    const s = play(initialTimeline());
    const p: PlaybackProgress = { positionUs: 2_000_000, totalUs: 6_000_000, ended: false };
    const next = withProgress(s, p);
    expect(next.totalUs).toBe(6_000_000);
    expect(next.positionUs).toBe(2_000_000);
    expect(next.playing).toBe(true);
    // end of stream pauses.
    const done = withProgress(s, { positionUs: 6_000_000, totalUs: 6_000_000, ended: true });
    expect(done.ended).toBe(true);
    expect(done.playing).toBe(false);
  });

  it('formats timecodes as m:ss / h:mm:ss', () => {
    expect(formatTimecode(0)).toBe('0:00');
    expect(formatTimecode(5_000_000)).toBe('0:05');
    expect(formatTimecode(65_000_000)).toBe('1:05');
    expect(formatTimecode(3_725_000_000)).toBe('1:02:05');
    expect(formatTimecode(-1)).toBe('0:00');
  });
});

// --- presets ---------------------------------------------------------------

describe('preset analyses (spec §4.8)', () => {
  it('ships the five named presets', () => {
    const ids = ANALYSIS_PRESETS.map((p) => p.id);
    expect(ids).toEqual(['vibration', 'ekf', 'battery', 'gps', 'pid']);
  });

  it('resolves a preset to a field-selection spec', () => {
    const vibe = getPreset('vibration');
    expect(vibe).toBeDefined();
    const spec = presetFieldSpec(vibe!);
    expect(spec.presetId).toBe('vibration');
    const xyz = spec.series.find((s) => s.id === 'vibe.xyz');
    expect(xyz?.fields).toEqual([
      { message: 'VIBRATION', field: 'vibration_x' },
      { message: 'VIBRATION', field: 'vibration_y' },
      { message: 'VIBRATION', field: 'vibration_z' },
    ]);
  });

  it('charts PID desired vs achieved on a shared axis', () => {
    const spec = presetFieldSpec(getPreset('pid')!);
    const desired = spec.series.find((s) => s.id === 'pid.desired');
    const achieved = spec.series.find((s) => s.id === 'pid.achieved');
    expect(desired?.fields).toEqual([{ message: 'PID_TUNING', field: 'desired' }]);
    expect(achieved?.fields).toEqual([{ message: 'PID_TUNING', field: 'achieved' }]);
    expect(desired?.axis).toBe(achieved?.axis);
  });

  it('returns undefined for an unknown preset id', () => {
    expect(getPreset('nope')).toBeUndefined();
  });
});

// --- controller adapter ----------------------------------------------------

describe('replay controller adapter', () => {
  it('maps command verbs onto the transport', () => {
    const m = makeTransport();
    const ctrl = createReplayController(m.transport, 5_000_000);
    ctrl.play();
    ctrl.pause();
    ctrl.step();
    ctrl.setSpeed(4);
    expect(m.resume).toHaveBeenCalledTimes(1);
    expect(m.paused).toHaveBeenCalledTimes(1);
    expect(m.step).toHaveBeenCalledTimes(1);
    expect(m.setSpeed).toHaveBeenCalledWith(4);
  });

  it('clamps + forwards seek and emits a progress report', () => {
    const m = makeTransport();
    const ctrl = createReplayController(m.transport, 5_000_000);
    const seen: PlaybackProgress[] = [];
    ctrl.subscribe((p) => seen.push(p));
    ctrl.seek(99_000_000); // beyond the end → clamped.
    expect(m.seek).toHaveBeenCalledWith(5_000_000);
    expect(seen.at(-1)).toEqual({ positionUs: 5_000_000, totalUs: 5_000_000, ended: true });
  });

  it('fans out report() to subscribers and stops after unsubscribe', () => {
    const m = makeTransport();
    const ctrl = createReplayController(m.transport, 5_000_000);
    const listener = vi.fn<(p: PlaybackProgress) => void>();
    const off = ctrl.subscribe(listener);
    ctrl.report(2_000_000);
    expect(listener).toHaveBeenLastCalledWith({
      positionUs: 2_000_000,
      totalUs: 5_000_000,
      ended: false,
    });
    off();
    ctrl.report(3_000_000);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

// --- open helpers ----------------------------------------------------------

describe('tlog open helpers', () => {
  it('computes the total duration from tlog bytes', () => {
    expect(tlogTotalUs(TLOG_5S)).toBe(5_000_000);
    expect(tlogTotalUs(new Uint8Array(0))).toBe(0);
  });

  it('openTlog opens the transport, starts paused, and exposes the duration', async () => {
    const m = makeTransport();
    const open = vi.fn<OpenableReplayTransport['open']>(async () => {});
    const transport: OpenableReplayTransport = { ...m.transport, open };
    const ctrl = await openTlog({ data: TLOG_5S, transport });
    expect(open).toHaveBeenCalledWith({ data: TLOG_5S });
    expect(m.paused).toHaveBeenCalledTimes(1); // startPaused default.
    const seen: PlaybackProgress[] = [];
    ctrl.subscribe((p) => seen.push(p));
    ctrl.seek(0);
    expect(seen.at(-1)?.totalUs).toBe(5_000_000);
  });

  it('loadTlogBytes reads the picked file, or undefined on cancel', async () => {
    const blob = new Blob([new Uint8Array(TLOG_5S)]);
    const fileIo: FileIo = {
      openForRead: vi.fn<FileIo['openForRead']>(async () => ({ name: 'flight.tlog', blob })),
      saveAs: vi.fn<FileIo['saveAs']>(async () => {}),
    };
    const got = await loadTlogBytes(fileIo);
    expect(got?.name).toBe('flight.tlog');
    expect(new Uint8Array(got!.data).byteLength).toBe(TLOG_5S.byteLength);

    const cancelIo: FileIo = {
      openForRead: vi.fn<FileIo['openForRead']>(async () => undefined),
      saveAs: vi.fn<FileIo['saveAs']>(async () => {}),
    };
    expect(await loadTlogBytes(cancelIo)).toBeUndefined();
  });
});
