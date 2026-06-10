import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConnState } from '../../src/contracts/transport';
import {
  ReplayTransport,
  parseTlog,
  TlogParseError,
  replayTransportFactory,
  type Scheduler,
  type TimeoutHandle,
} from '../../src/transport/replay';

// --- tlog / frame builders -------------------------------------------------

/** Build a MAVLink v1 frame (8 + payloadLen bytes) with deterministic content. */
function makeV1(payloadLen: number, seed: number): Uint8Array {
  const b = new Uint8Array(8 + payloadLen);
  for (let i = 0; i < b.length; i++) b[i] = (seed + i) & 0xff;
  b[0] = 0xfe;
  b[1] = payloadLen;
  return b;
}

/** Build a MAVLink v2 frame (12 + payloadLen [+13 if signed] bytes). */
function makeV2(payloadLen: number, signed: boolean, seed: number): Uint8Array {
  const sig = signed ? 13 : 0;
  const b = new Uint8Array(12 + payloadLen + sig);
  for (let i = 0; i < b.length; i++) b[i] = (seed + i) & 0xff;
  b[0] = 0xfd;
  b[1] = payloadLen;
  b[2] = signed ? 0x01 : 0x00;
  return b;
}

/** Concatenate timestamped frames into a tlog byte stream. */
function buildTlog(entries: { timestampUs: bigint; frame: Uint8Array }[]): Uint8Array {
  const total = entries.reduce((n, e) => n + 8 + e.frame.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let p = 0;
  for (const e of entries) {
    view.setBigUint64(p, e.timestampUs, false);
    p += 8;
    out.set(e.frame, p);
    p += e.frame.length;
  }
  return out;
}

/** Standard 3-frame fixture (v1, v2 unsigned, v2 signed). */
function fixture(): { tlog: Uint8Array; f0: Uint8Array; f1: Uint8Array; f2: Uint8Array } {
  const f0 = makeV1(3, 10); // timeUs 0
  const f1 = makeV2(5, false, 100); // timeUs 2000
  const f2 = makeV2(4, true, 200); // timeUs 5000
  const tlog = buildTlog([
    { timestampUs: 0n, frame: f0 },
    { timestampUs: 2000n, frame: f1 },
    { timestampUs: 5000n, frame: f2 },
  ]);
  return { tlog, f0, f1, f2 };
}

// --- deterministic scheduler ----------------------------------------------

/** A manual scheduler: replay queues exactly one timer at a time. */
class ManualScheduler implements Scheduler {
  private handle = 1;
  private readonly tasks = new Map<number, { cb: () => void; delayMs: number }>();

  setTimeout(handler: () => void, delayMs: number): TimeoutHandle {
    const h = this.handle++;
    this.tasks.set(h, { cb: handler, delayMs });
    return h;
  }

  clearTimeout(handle: TimeoutHandle): void {
    this.tasks.delete(handle);
  }

  /** Scheduled delays of all pending timers (in registration order). */
  get pendingDelays(): number[] {
    return [...this.tasks.values()].map((t) => t.delayMs);
  }

  /** Fire the single pending timer and return the delay it was scheduled with. */
  runNext(): number {
    const entry = [...this.tasks.entries()][0];
    if (entry === undefined) throw new Error('no pending task');
    const [h, task] = entry;
    this.tasks.delete(h);
    task.cb();
    return task.delayMs;
  }
}

/** Read one chunk, asserting the stream is not done. */
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array> {
  const r = await reader.read();
  if (r.done || r.value === undefined) throw new Error('stream ended unexpectedly');
  return r.value;
}

afterEach(() => {
  vi.useRealTimers();
});

// --- parser ----------------------------------------------------------------

describe('parseTlog', () => {
  it('splits mixed v1/v2/v2-signed frames with relative timestamps', () => {
    const { tlog, f0, f1, f2 } = fixture();
    const frames = parseTlog(tlog);
    expect(frames.length).toBe(3);
    expect(frames[0]?.timeUs).toBe(0);
    expect(frames[1]?.timeUs).toBe(2000);
    expect(frames[2]?.timeUs).toBe(5000);
    expect(frames[0]?.timeTicks).toBe(0n);
    expect(frames[1]?.timeTicks).toBe(2000n);
    expect(frames[0]?.bytes).toEqual(f0);
    expect(frames[1]?.bytes).toEqual(f1);
    expect(frames[2]?.bytes).toEqual(f2);
  });

  it('accepts an ArrayBuffer as well as a Uint8Array', () => {
    const { tlog } = fixture();
    const ab = tlog.slice().buffer;
    expect(parseTlog(ab).length).toBe(3);
  });

  it('tolerates a truncated trailing entry', () => {
    const { tlog, f2 } = fixture();
    // Append a timestamp + a partial v2 frame (header says more bytes than present).
    const partial = makeV2(8, false, 5).subarray(0, 6);
    const extra = buildTlog([{ timestampUs: 99999n, frame: f2 }]).subarray(0, 8 + 6);
    extra.set(partial, 8);
    const joined = new Uint8Array(tlog.length + extra.length);
    joined.set(tlog, 0);
    joined.set(extra, tlog.length);
    // The trailing partial frame is ignored; the 3 complete frames remain.
    expect(parseTlog(joined).length).toBe(3);
  });

  it('throws on an unknown MAVLink magic mid-stream', () => {
    const bad = makeV1(2, 0);
    bad[0] = 0x12; // not 0xFE/0xFD
    const tlog = buildTlog([{ timestampUs: 0n, frame: bad }]);
    expect(() => parseTlog(tlog)).toThrow(TlogParseError);
  });
});

// --- transport: emission order + timing -----------------------------------

describe('ReplayTransport playback', () => {
  it('emits each frame in order, scheduled by inter-frame timing', async () => {
    const { tlog, f0, f1, f2 } = fixture();
    const sched = new ManualScheduler();
    const t = new ReplayTransport({ scheduler: sched });
    const reader = t.readable.getReader();
    const states: ConnState['kind'][] = [];
    t.onState((s) => states.push(s.kind));

    await t.open({ data: tlog });
    // onState emitted the current 'closed' synchronously on subscribe, then
    // open() drives 'opening' -> 'open'.
    expect(states).toEqual(['closed', 'opening', 'open']);
    expect(sched.pendingDelays).toEqual([0]); // first frame is immediate

    expect(sched.runNext()).toBe(0);
    expect(await readChunk(reader)).toEqual(f0);
    expect(sched.pendingDelays).toEqual([2]); // (2000-0)us / 1000 / 1x

    expect(sched.runNext()).toBe(2);
    expect(await readChunk(reader)).toEqual(f1);
    expect(sched.pendingDelays).toEqual([3]); // (5000-2000)us / 1000 / 1x

    expect(sched.runNext()).toBe(3);
    expect(await readChunk(reader)).toEqual(f2);

    // End of stream: no more timers, state closed, reader done.
    expect(sched.pendingDelays).toEqual([]);
    expect(states[states.length - 1]).toBe('closed');
    expect((await reader.read()).done).toBe(true);

    const stats = t.stats();
    expect(stats.packetsIn).toBe(3);
    expect(stats.bytesIn).toBe(f0.length + f1.length + f2.length);
    expect(stats.bytesOut).toBe(0);
  });

  it('scales inter-frame delays by the open() speed', async () => {
    const { tlog } = fixture();
    const sched = new ManualScheduler();
    const t = new ReplayTransport({ scheduler: sched });
    const reader = t.readable.getReader();

    await t.open({ data: tlog, speed: 4 });
    expect(sched.runNext()).toBe(0); // frame 0
    await readChunk(reader);
    expect(sched.pendingDelays).toEqual([0.5]); // 2000us / 1000 / 4x
    sched.runNext();
    await readChunk(reader);
    expect(sched.pendingDelays).toEqual([0.75]); // 3000us / 1000 / 4x
  });

  it('setSpeed reschedules the current gap', async () => {
    const { tlog } = fixture();
    const sched = new ManualScheduler();
    const t = new ReplayTransport({ scheduler: sched });
    const reader = t.readable.getReader();

    await t.open({ data: tlog }); // speed 1
    sched.runNext(); // frame 0
    await readChunk(reader);
    expect(sched.pendingDelays).toEqual([2]); // 2000us @1x
    t.setSpeed(2);
    expect(sched.pendingDelays).toEqual([1]); // 2000us @2x
  });

  it('pause stops the clock and resume continues', async () => {
    const { tlog, f0, f1 } = fixture();
    const sched = new ManualScheduler();
    const t = new ReplayTransport({ scheduler: sched });
    const reader = t.readable.getReader();

    await t.open({ data: tlog });
    sched.runNext(); // frame 0
    expect(await readChunk(reader)).toEqual(f0);
    expect(sched.pendingDelays).toEqual([2]);

    t.pause();
    expect(sched.pendingDelays).toEqual([]); // timer cancelled

    t.resume();
    expect(sched.pendingDelays).toEqual([2]); // re-armed
    sched.runNext();
    expect(await readChunk(reader)).toEqual(f1);
  });

  it('seek jumps to the first frame at/after the target and emits it immediately', async () => {
    const { tlog, f1 } = fixture();
    const sched = new ManualScheduler();
    const t = new ReplayTransport({ scheduler: sched });
    const reader = t.readable.getReader();

    await t.open({ data: tlog }); // armed at frame 0
    t.seek(2000); // frame 1 is at 2000us
    expect(sched.pendingDelays).toEqual([0]); // immediate
    sched.runNext();
    expect(await readChunk(reader)).toEqual(f1);
  });

  it('step emits exactly one frame and stays paused; end-of-stream closes', async () => {
    const { tlog, f0, f1, f2 } = fixture();
    const sched = new ManualScheduler();
    const t = new ReplayTransport({ scheduler: sched });
    const reader = t.readable.getReader();
    const states: ConnState['kind'][] = [];
    t.onState((s) => states.push(s.kind));

    await t.open({ data: tlog });
    t.pause(); // cancel the auto-armed first frame
    expect(sched.pendingDelays).toEqual([]);

    t.step();
    expect(await readChunk(reader)).toEqual(f0);
    expect(sched.pendingDelays).toEqual([]); // still paused, nothing armed

    t.step();
    expect(await readChunk(reader)).toEqual(f1);

    t.step();
    expect(await readChunk(reader)).toEqual(f2);
    expect(states[states.length - 1]).toBe('closed');
    expect((await reader.read()).done).toBe(true);
  });

  it('emits opening -> open -> closed for an empty tlog', async () => {
    const sched = new ManualScheduler();
    const t = new ReplayTransport({ scheduler: sched });
    const reader = t.readable.getReader();
    const states: ConnState['kind'][] = [];
    t.onState((s) => states.push(s.kind));

    await t.open({ data: new Uint8Array(0) });
    expect(states).toEqual(['closed', 'opening', 'open', 'closed']);
    expect((await reader.read()).done).toBe(true);
  });

  it('onState emits the current state synchronously to a late subscriber', async () => {
    const { tlog } = fixture();
    const sched = new ManualScheduler();
    const t = new ReplayTransport({ scheduler: sched });

    await t.open({ data: tlog }); // now in 'open'
    const late: ConnState['kind'][] = [];
    t.onState((s) => late.push(s.kind));
    // The late subscriber receives the current state immediately on subscribe.
    expect(late).toEqual(['open']);
  });

  it('rejects re-open after end-of-stream / close (consumed controller, B1)', async () => {
    const { tlog } = fixture();
    const sched = new ManualScheduler();
    const t = new ReplayTransport({ scheduler: sched });
    const reader = t.readable.getReader();

    await t.open({ data: tlog });
    sched.runNext();
    await readChunk(reader);
    await t.close(); // controller closed for good

    await expect(t.open({ data: tlog })).rejects.toThrow(
      'transport already consumed; create a new instance',
    );
  });

  it('rejects open() while already open (B1)', async () => {
    const { tlog } = fixture();
    const sched = new ManualScheduler();
    const t = new ReplayTransport({ scheduler: sched });

    await t.open({ data: tlog });
    await expect(t.open({ data: tlog })).rejects.toThrow('replay transport: already open');
    await t.close();
  });

  it('readable.cancel() closes the transport so later step/seek cannot enqueue (B2)', async () => {
    const { tlog } = fixture();
    const sched = new ManualScheduler();
    const t = new ReplayTransport({ scheduler: sched });
    const reader = t.readable.getReader();
    const states: ConnState['kind'][] = [];
    t.onState((s) => states.push(s.kind));

    await t.open({ data: tlog });
    await reader.cancel();

    expect(states[states.length - 1]).toBe('closed');
    expect(sched.pendingDelays).toEqual([]);
    // Closed: these must be no-ops, not enqueue-on-closed-controller throws.
    expect(() => t.step()).not.toThrow();
    expect(() => t.seek(2000)).not.toThrow();
    // A consumed transport cannot be re-opened.
    await expect(t.open({ data: tlog })).rejects.toThrow(
      'transport already consumed; create a new instance',
    );
  });

  it('close() emits closed and ends the stream', async () => {
    const { tlog } = fixture();
    const sched = new ManualScheduler();
    const t = new ReplayTransport({ scheduler: sched });
    const reader = t.readable.getReader();
    const states: ConnState['kind'][] = [];
    t.onState((s) => states.push(s.kind));

    await t.open({ data: tlog });
    await t.close();
    expect(states[states.length - 1]).toBe('closed');
    expect((await reader.read()).done).toBe(true);
  });
});

// --- writable is a no-op sink ---------------------------------------------

describe('ReplayTransport writable', () => {
  it('discards writes without error and does not affect stats', async () => {
    const t = new ReplayTransport({ scheduler: new ManualScheduler() });
    const w = t.writable.getWriter();
    await expect(w.write(new Uint8Array([1, 2, 3]))).resolves.toBeUndefined();
    await w.close();
    const stats = t.stats();
    expect(stats.bytesOut).toBe(0);
    expect(stats.bytesIn).toBe(0);
  });
});

// --- config validation -----------------------------------------------------

describe('ReplayTransport.open validation', () => {
  it('rejects non-object config and bad data/speed', async () => {
    const t = new ReplayTransport({ scheduler: new ManualScheduler() });
    await expect(t.open(null)).rejects.toBeInstanceOf(TypeError);
    await expect(t.open({})).rejects.toBeInstanceOf(TypeError);
    await expect(t.open({ data: new Uint8Array(0), speed: 0 })).rejects.toBeInstanceOf(RangeError);
    await expect(t.open({ data: new Uint8Array(0), speed: -1 })).rejects.toBeInstanceOf(RangeError);
  });

  it('setSpeed rejects non-positive values', () => {
    const t = new ReplayTransport({ scheduler: new ManualScheduler() });
    expect(() => t.setSpeed(0)).toThrow(RangeError);
    expect(() => t.setSpeed(Number.NaN)).toThrow(RangeError);
  });
});

// --- factory ---------------------------------------------------------------

describe('replayTransportFactory', () => {
  it('is supported and creates ReplayTransport instances with control methods', () => {
    expect(replayTransportFactory.id).toBe('replay');
    expect(replayTransportFactory.label).toBeTruthy();
    expect(replayTransportFactory.isSupported()).toBe(true);
    const inst = replayTransportFactory.create();
    expect(inst).toBeInstanceOf(ReplayTransport);
    const r = inst as ReplayTransport;
    expect(typeof r.seek).toBe('function');
    expect(typeof r.setSpeed).toBe('function');
    expect(typeof r.pause).toBe('function');
    expect(typeof r.resume).toBe('function');
    expect(typeof r.step).toBe('function');
  });
});

// --- fake-timers path ------------------------------------------------------

describe('ReplayTransport with vi.useFakeTimers (default scheduler)', () => {
  it('schedules frames on the fake clock', async () => {
    vi.useFakeTimers();
    const { tlog, f0, f1, f2 } = fixture();
    const t = new ReplayTransport(); // default scheduler -> ambient setTimeout
    const reader = t.readable.getReader();

    await t.open({ data: tlog });
    await vi.advanceTimersByTimeAsync(0); // frame 0 (delay 0)
    expect(await readChunk(reader)).toEqual(f0);
    await vi.advanceTimersByTimeAsync(2); // frame 1 at +2ms
    expect(await readChunk(reader)).toEqual(f1);
    await vi.advanceTimersByTimeAsync(3); // frame 2 at +3ms
    expect(await readChunk(reader)).toEqual(f2);
    expect((await reader.read()).done).toBe(true);
  });
});
