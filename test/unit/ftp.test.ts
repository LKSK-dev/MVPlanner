import { describe, it, expect } from 'vitest';
import {
  FTP_HEADER_LEN,
  FTP_PAYLOAD_LEN,
  FtpClient,
  FtpError,
  FtpNak,
  FtpOpcode,
  createFtpClient,
  decodePayload,
  encodePayload,
  type FtpClock,
  type FtpTarget,
} from '../../src/mavlink/microservices/ftp';
import type { DecodedMessage } from '../../src/contracts';

// ---------------------------------------------------------------------------
// Deterministic fake clock — fires due timers in chronological order, including
// timers scheduled by an earlier timer's callback (retry loop).
// ---------------------------------------------------------------------------

class FakeClock implements FtpClock {
  private now = 0;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; cb: () => void }>();

  setTimeout(handler: () => void, ms: number): () => void {
    const id = this.seq++;
    this.timers.set(id, { at: this.now + ms, cb: handler });
    return () => void this.timers.delete(id);
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let nextId: number | undefined;
      let nextAt = Infinity;
      for (const [id, t] of this.timers) {
        if (t.at <= target && t.at < nextAt) {
          nextAt = t.at;
          nextId = id;
        }
      }
      if (nextId === undefined) break;
      const t = this.timers.get(nextId);
      this.timers.delete(nextId);
      if (t !== undefined) {
        this.now = t.at;
        t.cb();
      }
    }
    this.now = target;
  }
}

// ---------------------------------------------------------------------------
// Mock host: captures sent FTP payloads and lets a test script "the vehicle"
// reply with Ack/Nak/data frames correlated by sequence number.
// ---------------------------------------------------------------------------

const TARGET: FtpTarget = { network: 0, system: 1, component: 1 };

interface SentFtp {
  seq: number;
  opcode: number;
  session: number;
  size: number;
  offset: number;
  data: Uint8Array;
}

class MockHost {
  readonly sent: SentFtp[] = [];
  private cb: ((msg: DecodedMessage) => void) | undefined;

  readonly sendMessage = (name: string, fields: Record<string, unknown>): void => {
    expect(name).toBe('FILE_TRANSFER_PROTOCOL');
    const payload = fields.payload as number[];
    const p = decodePayload(payload);
    this.sent.push({
      seq: p.seq,
      opcode: p.opcode,
      session: p.session,
      size: p.size,
      offset: p.offset,
      data: p.data,
    });
  };

  readonly onMessage = (
    _names: readonly string[],
    cb: (msg: DecodedMessage) => void,
  ): (() => void) => {
    this.cb = cb;
    return () => {
      this.cb = undefined;
    };
  };

  get last(): SentFtp {
    const s = this.sent[this.sent.length - 1];
    if (s === undefined) throw new Error('no FTP frame sent');
    return s;
  }

  /** Deliver an FTP response with `reply.seq = requestSeq + 1`. */
  reply(
    requestSeq: number,
    opcode: number,
    opts: {
      session?: number;
      offset?: number;
      data?: Uint8Array;
      sysid?: number;
      compid?: number;
      burstComplete?: number;
      seq?: number;
      reqOpcode?: number;
    } = {},
  ): void {
    const request = this.sent.find((s) => s.seq === requestSeq);
    const payload = encodePayload({
      seq: opts.seq ?? (requestSeq + 1) & 0xffff,
      session: opts.session ?? request?.session ?? 0,
      opcode,
      offset: opts.offset ?? 0,
      data: opts.data ?? new Uint8Array(0),
    });
    payload[5] = opts.reqOpcode ?? request?.opcode ?? 0;
    payload[6] = opts.burstComplete ?? 0;
    this.cb?.({
      sysid: opts.sysid ?? TARGET.system,
      compid: opts.compid ?? TARGET.component,
      seq: 0,
      msgId: 110,
      name: 'FILE_TRANSFER_PROTOCOL',
      fields: { target_network: 0, target_system: 0, target_component: 0, payload },
      crcOk: true,
      signed: false,
      rxTimeUs: 0,
      raw: new Uint8Array(),
    });
  }

  /** Reply Ack to the most recent request after a microtask (await its send). */
  ackLast(opts: Parameters<MockHost['reply']>[2] = {}): void {
    this.reply(this.last.seq, FtpOpcode.Ack, opts);
  }

  nakLast(code: number, opts: { session?: number } = {}): void {
    this.reply(this.last.seq, FtpOpcode.Nak, {
      ...opts,
      data: new Uint8Array([code]),
    });
  }
}

function setup(extra: Partial<ConstructorParameters<typeof FtpClient>[0]> = {}): {
  host: MockHost;
  clock: FakeClock;
  client: FtpClient;
} {
  const host = new MockHost();
  const clock = new FakeClock();
  const client = createFtpClient({
    sendMessage: host.sendMessage,
    onMessage: host.onMessage,
    target: TARGET,
    clock,
    timeoutMs: 800,
    maxRetries: 4,
    ...extra,
  });
  return { host, clock, client };
}

/** Build a NUL-terminated directory record (`type` + name [+ \t size]). */
function dirRecord(type: 'F' | 'D' | 'S', name = '', size?: number): Uint8Array {
  const text = type === 'F' && size !== undefined ? `F${name}\t${size}` : `${type}${name}`;
  const body = new TextEncoder().encode(text);
  const out = new Uint8Array(body.byteLength + 1);
  out.set(body, 0);
  out[body.byteLength] = 0; // NUL terminator
  return out;
}

function joinRecords(...recs: Uint8Array[]): Uint8Array {
  const total = recs.reduce((n, r) => n + r.byteLength, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const r of recs) {
    out.set(r, at);
    at += r.byteLength;
  }
  return out;
}

/** Flush pending microtasks so nested async continuations send their next request. */
const tick = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

// ---------------------------------------------------------------------------

describe('FTP payload codec', () => {
  it('round-trips header fields and trims data to size', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const arr = encodePayload({ seq: 0x1234, session: 7, opcode: 5, offset: 0xdeadbeef, data });
    expect(arr).toHaveLength(FTP_PAYLOAD_LEN);
    const p = decodePayload(arr);
    expect(p).toMatchObject({ seq: 0x1234, session: 7, opcode: 5, size: 5, offset: 0xdeadbeef });
    expect([...p.data]).toEqual([1, 2, 3, 4, 5]);
    // data starts at the documented header offset.
    expect(arr[FTP_HEADER_LEN]).toBe(1);
  });
});

describe('FtpClient.read', () => {
  it('reads a multi-chunk file by offset into the exact bytes', async () => {
    const { host, client } = setup({ chunkSize: 4 });
    const pr = client.read('@PARAM/param.pck');

    // OpenFileRO: Ack carries the 8-byte file size (u32 LE) — here 8 bytes.
    await tick();
    expect(host.last.opcode).toBe(FtpOpcode.OpenFileRO);
    host.ackLast({ session: 3, data: new Uint8Array([8, 0, 0, 0]) });

    // BurstReadFile is preferred; this mock peer reports it unsupported, so the
    // client falls back to sequential ReadFile.
    await tick();
    expect(host.last).toMatchObject({
      opcode: FtpOpcode.BurstReadFile,
      session: 3,
      offset: 0,
      size: 4,
    });
    host.nakLast(FtpNak.UnknownCommand);

    // Chunk 1 @0
    await tick();
    expect(host.last).toMatchObject({ opcode: FtpOpcode.ReadFile, session: 3, offset: 0, size: 4 });
    host.ackLast({ session: 3, offset: 0, data: new Uint8Array([10, 11, 12, 13]) });

    // Chunk 2 @4
    await tick();
    expect(host.last).toMatchObject({ opcode: FtpOpcode.ReadFile, offset: 4 });
    host.ackLast({ session: 3, offset: 4, data: new Uint8Array([20, 21, 22, 23]) });

    // The reported file size is satisfied, so the client terminates without an
    // extra EOF probe.
    await tick();
    expect(host.last.opcode).toBe(FtpOpcode.TerminateSession);
    host.ackLast({ session: 3 });

    const bytes = await pr;
    expect([...bytes]).toEqual([10, 11, 12, 13, 20, 21, 22, 23]);
  });

  it('assembles burst-read frames by offset before terminating', async () => {
    const { host, client } = setup({ chunkSize: 4 });
    const pr = client.read('log.bin');

    await tick();
    host.ackLast({ session: 7, data: new Uint8Array([8, 0, 0, 0]) });

    await tick();
    expect(host.last).toMatchObject({ opcode: FtpOpcode.BurstReadFile, session: 7, offset: 0 });
    const burstSeq = host.last.seq;
    // Deliberately out of order; the client sorts and appends only contiguous data.
    host.reply(burstSeq, FtpOpcode.Ack, {
      session: 7,
      offset: 4,
      data: new Uint8Array([5, 6, 7, 8]),
    });
    host.reply(burstSeq, FtpOpcode.Ack, {
      session: 7,
      offset: 0,
      data: new Uint8Array([1, 2, 3, 4]),
      burstComplete: 1,
    });

    await tick();
    expect(host.last.opcode).toBe(FtpOpcode.TerminateSession);
    host.ackLast({ session: 7 });

    await expect(pr).resolves.toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it('accepts incrementing burst-read sequences and advances past the highest reply', async () => {
    const { host, client } = setup({ chunkSize: 4 });
    const pr = client.read('incrementing.bin');

    await tick();
    host.ackLast({ session: 9, data: new Uint8Array([8, 0, 0, 0]) });

    await tick();
    expect(host.last).toMatchObject({ opcode: FtpOpcode.BurstReadFile, session: 9, offset: 0 });
    const burstSeq = host.last.seq;
    host.reply(burstSeq, FtpOpcode.Ack, {
      session: 9,
      offset: 0,
      data: new Uint8Array([1, 2, 3, 4]),
      seq: (burstSeq + 1) & 0xffff,
    });
    host.reply(burstSeq, FtpOpcode.Ack, {
      session: 9,
      offset: 4,
      data: new Uint8Array([5, 6, 7, 8]),
      seq: (burstSeq + 2) & 0xffff,
      burstComplete: 1,
    });

    await tick();
    expect(host.last).toMatchObject({ opcode: FtpOpcode.TerminateSession, session: 9 });
    expect(host.last.seq).toBe((burstSeq + 3) & 0xffff);
    host.ackLast({ session: 9 });

    await expect(pr).resolves.toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it('ignores a stale burst reply that shares the next transaction sequence', async () => {
    const { host, client } = setup({ chunkSize: 4 });
    const first = client.read('first.bin');

    await tick();
    host.ackLast({ session: 10, data: new Uint8Array([4, 0, 0, 0]) });
    await tick();
    host.reply(host.last.seq, FtpOpcode.Ack, {
      session: 10,
      offset: 0,
      data: new Uint8Array([1, 2, 3, 4]),
      burstComplete: 1,
    });
    await tick();
    host.ackLast({ session: 10 });
    await expect(first).resolves.toEqual(new Uint8Array([1, 2, 3, 4]));

    const second = client.read('second.bin');
    await tick();
    const openSeq = host.last.seq;
    host.reply(openSeq, FtpOpcode.Ack, {
      session: 10,
      reqOpcode: FtpOpcode.BurstReadFile,
      seq: (openSeq + 1) & 0xffff,
      data: new Uint8Array([9, 9, 9, 9]),
    });
    await tick();
    expect(host.last.seq).toBe(openSeq);

    host.ackLast({ session: 11, data: new Uint8Array([0, 0, 0, 0]) });
    await tick();
    host.nakLast(FtpNak.EndOfFile, { session: 11 });
    await tick();
    host.ackLast({ session: 11 });
    await expect(second).resolves.toEqual(new Uint8Array([]));
  });

  it('re-requests a burst-read gap before appending', async () => {
    const { host, client } = setup({ chunkSize: 4 });
    const pr = client.read('gap.bin');

    await tick();
    host.ackLast({ session: 8, data: new Uint8Array([8, 0, 0, 0]) });

    await tick();
    expect(host.last.opcode).toBe(FtpOpcode.BurstReadFile);
    const firstBurstSeq = host.last.seq;
    host.reply(firstBurstSeq, FtpOpcode.Ack, {
      session: 8,
      offset: 4,
      data: new Uint8Array([5, 6, 7, 8]),
      burstComplete: 1,
    });

    await tick();
    expect(host.last).toMatchObject({ opcode: FtpOpcode.BurstReadFile, offset: 0 });
    const secondBurstSeq = host.last.seq;
    host.reply(secondBurstSeq, FtpOpcode.Ack, {
      session: 8,
      offset: 0,
      data: new Uint8Array([1, 2, 3, 4]),
    });
    host.reply(secondBurstSeq, FtpOpcode.Ack, {
      session: 8,
      offset: 4,
      data: new Uint8Array([5, 6, 7, 8]),
      burstComplete: 1,
    });

    await tick();
    expect(host.last.opcode).toBe(FtpOpcode.TerminateSession);
    host.ackLast({ session: 8 });

    await expect(pr).resolves.toEqual(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it('reports progress against the OpenFileRO file size', async () => {
    const { host, client } = setup({ chunkSize: 4 });
    const progress: Array<[number, number]> = [];
    const pr = client.read('f', (done, total) => progress.push([done, total]));

    await tick();
    host.ackLast({ session: 1, data: new Uint8Array([8, 0, 0, 0]) }); // size 8
    await tick();
    expect(host.last.opcode).toBe(FtpOpcode.BurstReadFile);
    host.nakLast(FtpNak.UnknownCommand);
    await tick();
    host.ackLast({ session: 1, data: new Uint8Array([1, 2, 3, 4]) });
    await tick();
    host.ackLast({ session: 1, data: new Uint8Array([5, 6, 7, 8]) });
    await tick();
    host.nakLast(FtpNak.EndOfFile);
    await tick();
    host.ackLast({ session: 1 }); // terminate

    await pr;
    expect(progress).toEqual([
      [4, 8],
      [8, 8],
    ]);
  });

  it('ends cleanly on a short/empty final chunk (no NAK)', async () => {
    const { host, client } = setup({ chunkSize: 4 });
    const pr = client.read('f');
    await tick();
    host.ackLast({ session: 2, data: new Uint8Array([0, 0, 0, 0]) }); // size unknown→0
    await tick();
    expect(host.last.opcode).toBe(FtpOpcode.BurstReadFile);
    host.nakLast(FtpNak.UnknownCommand);
    await tick();
    host.ackLast({ session: 2, data: new Uint8Array([9, 9]) }); // short chunk
    await tick();
    host.ackLast({ session: 2, data: new Uint8Array(0) }); // empty ⇒ EOF
    await tick();
    host.ackLast({ session: 2 }); // terminate
    expect([...(await pr)]).toEqual([9, 9]);
  });

  it('rejects on a real (non-EOF) NAK during read', async () => {
    const { host, client } = setup();
    const pr = client.read('nope');
    await tick();
    host.nakLast(FtpNak.FileNotFound); // OpenFileRO fails
    await expect(pr).rejects.toMatchObject({
      name: 'FtpError',
      reason: 'nak',
      nak: FtpNak.FileNotFound,
    });
  });
});

describe('FtpClient.list', () => {
  it('lists a directory, paging by entry offset until EOF', async () => {
    const { host, client } = setup();
    const pr = client.list('/');

    // Page 1: two entries (file + dir).
    await tick();
    expect(host.last).toMatchObject({ opcode: FtpOpcode.ListDirectory, offset: 0 });
    expect(new TextDecoder().decode(host.last.data)).toBe('/');
    host.ackLast({ data: joinRecords(dirRecord('F', 'a.txt', 12), dirRecord('D', 'logs')) });

    // Page 2: skip entry + one more file; offset advanced by 2.
    await tick();
    expect(host.last.offset).toBe(2);
    host.ackLast({ data: joinRecords(dirRecord('S', '.'), dirRecord('F', 'b.bin', 7)) });

    // Page 3: EOF NAK ends paging; offset advanced by 2 again.
    await tick();
    expect(host.last.offset).toBe(4);
    host.nakLast(FtpNak.EndOfFile);

    const entries = await pr;
    expect(entries).toEqual([
      { name: 'a.txt', size: 12, dir: false },
      { name: 'logs', size: 0, dir: true },
      { name: 'b.bin', size: 7, dir: false },
    ]);
  });

  it('rejects on a non-EOF NAK during list', async () => {
    const { host, client } = setup();
    const pr = client.list('/bad');
    await tick();
    host.nakLast(FtpNak.Fail);
    await expect(pr).rejects.toMatchObject({ reason: 'nak', nak: FtpNak.Fail });
  });
});

describe('FtpClient transaction robustness', () => {
  it('retries on timeout then resolves once the reply arrives', async () => {
    const { host, clock, client } = setup({ timeoutMs: 800, maxRetries: 4 });
    const pr = client.list('/');
    await tick();
    expect(host.sent).toHaveLength(1);
    const seq = host.last.seq;

    clock.advance(800); // first retry — identical frame, same seq
    expect(host.sent).toHaveLength(2);
    expect(host.last.seq).toBe(seq);
    clock.advance(800); // second retry
    expect(host.sent).toHaveLength(3);

    host.reply(seq, FtpOpcode.Nak, { data: new Uint8Array([FtpNak.EndOfFile]) });
    await expect(pr).resolves.toEqual([]);

    // No further frames after settling.
    clock.advance(5000);
    expect(host.sent).toHaveLength(3);
  });

  it('rejects with a timeout after the retry budget is exhausted', async () => {
    const { clock, client } = setup({ timeoutMs: 800, maxRetries: 2 });
    const pr = client.list('/');
    const expectation = expect(pr).rejects.toMatchObject({ name: 'FtpError', reason: 'timeout' });
    await tick();
    clock.advance(800); // retry 1
    clock.advance(800); // retry 2
    clock.advance(800); // budget exhausted ⇒ reject
    await expectation;
  });

  it('ignores replies with a mismatched sequence number', async () => {
    const { host, client } = setup();
    const pr = client.list('/');
    await tick();
    const seq = host.last.seq;
    // Wrong seq (not request+1) — must be ignored.
    host.reply(seq + 10, FtpOpcode.Nak, { data: new Uint8Array([FtpNak.EndOfFile]) });
    // Correct correlation resolves it.
    host.reply(seq, FtpOpcode.Nak, { data: new Uint8Array([FtpNak.EndOfFile]) });
    await expect(pr).resolves.toEqual([]);
  });

  it('ignores replies from a different system/component', async () => {
    const { host, client } = setup();
    const pr = client.list('/');
    await tick();
    const seq = host.last.seq;
    host.reply(seq, FtpOpcode.Nak, { data: new Uint8Array([FtpNak.EndOfFile]), sysid: 99 });
    host.reply(seq, FtpOpcode.Nak, { data: new Uint8Array([FtpNak.EndOfFile]), compid: 42 });
    // Neither correlated; the real target does.
    host.reply(seq, FtpOpcode.Nak, { data: new Uint8Array([FtpNak.EndOfFile]) });
    await expect(pr).resolves.toEqual([]);
  });

  it('advances the sequence so reads correlate the right chunk', async () => {
    const { host, client } = setup({ chunkSize: 4 });
    const pr = client.read('f');
    await tick();
    const openSeq = host.last.seq;
    host.ackLast({ session: 5, data: new Uint8Array([4, 0, 0, 0]) });
    await tick();
    const burstSeq = host.last.seq;
    expect(burstSeq).not.toBe(openSeq); // fresh seq pair per transaction
    host.nakLast(FtpNak.UnknownCommand);
    await tick();
    const readSeq = host.last.seq;
    expect(readSeq).not.toBe(burstSeq);
    host.ackLast({ session: 5, data: new Uint8Array([1, 2, 3, 4]) });
    await tick();
    host.nakLast(FtpNak.EndOfFile);
    await tick();
    host.ackLast({ session: 5 });
    expect([...(await pr)]).toEqual([1, 2, 3, 4]);
  });

  it('cancels promptly when the abort signal fires', async () => {
    const { host, client } = setup();
    const ac = new AbortController();
    const pr = client.read('f', undefined, ac.signal);
    await tick();
    expect(host.last.opcode).toBe(FtpOpcode.OpenFileRO);
    ac.abort();
    await expect(pr).rejects.toMatchObject({ name: 'FtpError', reason: 'aborted' });
  });
});

describe('FtpClient.write and remove', () => {
  it('writes a multi-chunk file then terminates the session', async () => {
    const { host, client } = setup({ chunkSize: 3 });
    const data = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const pr = client.write('/APM/scripts/a.lua', data);

    await tick();
    expect(host.last.opcode).toBe(FtpOpcode.CreateFile);
    expect(new TextDecoder().decode(host.last.data)).toBe('/APM/scripts/a.lua');
    host.ackLast({ session: 11 });

    await tick();
    expect(host.last).toMatchObject({
      opcode: FtpOpcode.WriteFile,
      session: 11,
      offset: 0,
      size: 3,
    });
    expect([...host.last.data]).toEqual([1, 2, 3]);
    host.ackLast({ session: 11 });

    await tick();
    expect(host.last).toMatchObject({
      opcode: FtpOpcode.WriteFile,
      session: 11,
      offset: 3,
      size: 3,
    });
    expect([...host.last.data]).toEqual([4, 5, 6]);
    host.ackLast({ session: 11 });

    await tick();
    expect(host.last).toMatchObject({
      opcode: FtpOpcode.WriteFile,
      session: 11,
      offset: 6,
      size: 2,
    });
    expect([...host.last.data]).toEqual([7, 8]);
    host.ackLast({ session: 11 });

    await tick();
    expect(host.last).toMatchObject({ opcode: FtpOpcode.TerminateSession, session: 11 });
    host.ackLast({ session: 11 });

    await expect(pr).resolves.toBeUndefined();
  });

  it('rejects write on a WriteFile NAK and still terminates', async () => {
    const { host, client } = setup({ chunkSize: 4 });
    const pr = client.write('/f', new Uint8Array([1, 2, 3, 4]));

    await tick();
    host.ackLast({ session: 12 });
    await tick();
    host.nakLast(FtpNak.FileProtected);
    await tick();
    expect(host.last).toMatchObject({ opcode: FtpOpcode.TerminateSession, session: 12 });
    host.ackLast({ session: 12 });

    await expect(pr).rejects.toMatchObject({ reason: 'nak', nak: FtpNak.FileProtected });
  });

  it('removes a file on ACK and rejects on NAK', async () => {
    const ok = setup();
    const okPr = ok.client.remove('/tmp/old.txt');
    await tick();
    expect(ok.host.last.opcode).toBe(FtpOpcode.RemoveFile);
    expect(new TextDecoder().decode(ok.host.last.data)).toBe('/tmp/old.txt');
    ok.host.ackLast();
    await expect(okPr).resolves.toBeUndefined();

    const bad = setup();
    const badPr = bad.client.remove('/tmp/missing.txt');
    await tick();
    bad.host.nakLast(FtpNak.FileNotFound);
    await expect(badPr).rejects.toMatchObject({ reason: 'nak', nak: FtpNak.FileNotFound });
  });

  it('remove honors abort signals', async () => {
    const { host, client } = setup();
    const ac = new AbortController();
    const pr = client.remove('/tmp/slow.txt', ac.signal);
    await tick();
    expect(host.last.opcode).toBe(FtpOpcode.RemoveFile);
    ac.abort();
    await expect(pr).rejects.toBeInstanceOf(FtpError);
  });
});
