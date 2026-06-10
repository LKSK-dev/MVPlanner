import { describe, it, expect } from 'vitest';
import {
  LOG_DATA,
  LOG_ENTRY,
  LOG_ERASE,
  LOG_REQUEST_DATA,
  LOG_REQUEST_END,
  LOG_REQUEST_LIST,
  LogClient,
  type LogClock,
  type LogTarget,
  createLogClient,
} from '../../src/mavlink/microservices/log';
import type { DecodedMessage, FieldValue } from '../../src/contracts';

class FakeClock implements LogClock {
  private now = 0;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; cb: () => void }>();

  setTimeout(handler: () => void, ms: number): () => void {
    const id = this.seq++;
    this.timers.set(id, { at: this.now + ms, cb: handler });
    return () => {
      this.timers.delete(id);
    };
  }

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      let nextId: number | undefined;
      let nextAt = Infinity;
      for (const [id, timer] of this.timers) {
        if (timer.at <= target && timer.at < nextAt) {
          nextAt = timer.at;
          nextId = id;
        }
      }
      if (nextId === undefined) break;
      const timer = this.timers.get(nextId);
      this.timers.delete(nextId);
      if (timer !== undefined) {
        this.now = timer.at;
        timer.cb();
      }
    }
    this.now = target;
  }
}

type Sent = { name: string; fields: Record<string, unknown> };

class MockHost {
  readonly sent: Sent[] = [];
  private cb: ((msg: DecodedMessage) => void) | undefined;

  readonly sendMessage = (name: string, fields: Record<string, unknown>): void => {
    this.sent.push({ name, fields });
  };

  readonly onMessage = (
    names: readonly string[],
    cb: (msg: DecodedMessage) => void,
  ): (() => void) => {
    expect(names).toEqual([LOG_ENTRY, LOG_DATA]);
    this.cb = cb;
    return () => {
      this.cb = undefined;
    };
  };

  emitEntry(opts: {
    id: number;
    size: number;
    numLogs: number;
    lastLogNum: number;
    timeUtc?: number;
    sysid?: number;
    compid?: number;
  }): void {
    const fields: Record<string, FieldValue> = {
      id: opts.id,
      size: opts.size,
      num_logs: opts.numLogs,
      last_log_num: opts.lastLogNum,
      time_utc: opts.timeUtc ?? 0,
    };
    this.emit({
      sysid: opts.sysid ?? 1,
      compid: opts.compid ?? 1,
      msgId: 118,
      name: LOG_ENTRY,
      fields,
    });
  }

  emitData(opts: {
    id: number;
    ofs: number;
    data: readonly number[];
    count?: number;
    sysid?: number;
    compid?: number;
  }): void {
    const fields: Record<string, FieldValue> = {
      id: opts.id,
      ofs: opts.ofs,
      count: opts.count ?? opts.data.length,
      data: [...opts.data],
    };
    this.emit({
      sysid: opts.sysid ?? 1,
      compid: opts.compid ?? 1,
      msgId: 120,
      name: LOG_DATA,
      fields,
    });
  }

  byName(name: string): Sent[] {
    return this.sent.filter((s) => s.name === name);
  }

  private emit(partial: {
    sysid: number;
    compid: number;
    msgId: number;
    name: string;
    fields: Record<string, FieldValue>;
  }): void {
    this.cb?.({
      ...partial,
      seq: 0,
      crcOk: true,
      signed: false,
      rxTimeUs: 0,
      raw: new Uint8Array(),
    });
  }
}

const TARGET: LogTarget = { sysid: 1, compid: 1 };

function setup(extra: Partial<ConstructorParameters<typeof LogClient>[0]> = {}): {
  host: MockHost;
  clock: FakeClock;
  client: LogClient;
} {
  const host = new MockHost();
  const clock = new FakeClock();
  const client = createLogClient({
    sendMessage: host.sendMessage,
    onMessage: host.onMessage,
    getTarget: () => TARGET,
    clock,
    quietMs: 100,
    maxStallRounds: 2,
    ...extra,
  });
  return { host, clock, client };
}

describe('LogClient — list', () => {
  it('assembles LogEntry[] from LOG_ENTRY frames', async () => {
    const { host, client } = setup();

    const pr = client.list();
    expect(host.byName(LOG_REQUEST_LIST)).toHaveLength(1);
    expect(host.byName(LOG_REQUEST_LIST)[0]?.fields).toMatchObject({
      target_system: 1,
      target_component: 1,
      start: 0,
      end: 0xffff,
    });

    host.emitEntry({ id: 2, size: 30, numLogs: 3, lastLogNum: 2, timeUtc: 1234 });
    host.emitEntry({ id: 0, size: 10, numLogs: 3, lastLogNum: 2 });
    host.emitEntry({ id: 1, size: 20, numLogs: 3, lastLogNum: 2, timeUtc: 5678 });

    await expect(pr).resolves.toEqual([
      { id: 0, sizeBytes: 10 },
      { id: 1, sizeBytes: 20, utc: 5678 },
      { id: 2, sizeBytes: 30, utc: 1234 },
    ]);
  });

  it('re-requests missing LOG_ENTRY id ranges after the quiet window', async () => {
    const { host, clock, client } = setup();

    const pr = client.list();
    host.emitEntry({ id: 0, size: 10, numLogs: 4, lastLogNum: 3 });
    host.emitEntry({ id: 3, size: 40, numLogs: 4, lastLogNum: 3 });

    clock.advance(100);
    const requests = host.byName(LOG_REQUEST_LIST);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.fields).toMatchObject({ start: 1, end: 2 });

    host.emitEntry({ id: 1, size: 20, numLogs: 4, lastLogNum: 3 });
    host.emitEntry({ id: 2, size: 30, numLogs: 4, lastLogNum: 3 });

    await expect(pr).resolves.toEqual([
      { id: 0, sizeBytes: 10 },
      { id: 1, sizeBytes: 20 },
      { id: 2, sizeBytes: 30 },
      { id: 3, sizeBytes: 40 },
    ]);
  });
});

describe('LogClient — download', () => {
  it('assembles ordered bytes from out-of-order LOG_DATA and resumes a dropped offset', async () => {
    const { host, clock, client } = setup();
    const list = client.list();
    host.emitEntry({ id: 7, size: 6, numLogs: 1, lastLogNum: 7 });
    await list;

    const progress: Array<[number, number]> = [];
    const download = client.download(7, (done, total) => progress.push([done, total]));
    expect(host.byName(LOG_REQUEST_DATA)[0]?.fields).toMatchObject({
      target_system: 1,
      target_component: 1,
      id: 7,
      ofs: 0,
      count: 0xffffffff,
    });

    host.emitData({ id: 7, ofs: 4, data: [5, 6] });
    host.emitData({ id: 7, ofs: 0, data: [1, 2] });

    clock.advance(100);
    const dataRequests = host.byName(LOG_REQUEST_DATA);
    expect(dataRequests).toHaveLength(2);
    expect(dataRequests[1]?.fields).toMatchObject({ id: 7, ofs: 2, count: 2 });

    host.emitData({ id: 7, ofs: 2, data: [3, 4] });
    const blob = await download;
    expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(progress).toEqual([
      [0, 6],
      [2, 6],
      [4, 6],
      [6, 6],
    ]);
    expect(host.byName(LOG_REQUEST_END)).toHaveLength(1);
  });
});

describe('LogClient — erase', () => {
  it('sends LOG_ERASE to the active target', async () => {
    const { host, client } = setup();

    await client.erase();

    expect(host.byName(LOG_ERASE)).toHaveLength(1);
    expect(host.byName(LOG_ERASE)[0]?.fields).toEqual({
      target_system: 1,
      target_component: 1,
    });
  });

  it('clears the LOG_ENTRY size cache so recycled ids are re-listed', async () => {
    const { host, client } = setup();

    // Populate the cache with id 7 (size 6) via a list.
    const list = client.list();
    host.emitEntry({ id: 7, size: 6, numLogs: 1, lastLogNum: 7 });
    await list;
    expect(host.byName(LOG_REQUEST_LIST)).toHaveLength(1);

    await client.erase();

    // The stale size must not be reused: download(7) re-lists first instead of
    // immediately requesting data with the cached size.
    void client.download(7).catch(() => undefined);
    await Promise.resolve();
    expect(host.byName(LOG_REQUEST_DATA)).toHaveLength(0);
    expect(host.byName(LOG_REQUEST_LIST)).toHaveLength(2);
  });
});

describe('LogClient — timeout / abort', () => {
  it('rejects list with a timeout after bounded no-progress retries', async () => {
    const { clock, client } = setup({ maxStallRounds: 1 });
    const pr = client.list();
    const assertion = expect(pr).rejects.toMatchObject({ name: 'LogError', reason: 'timeout' });

    clock.advance(500);

    await assertion;
  });

  it('rejects download with a timeout and sends LOG_REQUEST_END', async () => {
    const { host, clock, client } = setup({ maxStallRounds: 1 });
    const list = client.list();
    host.emitEntry({ id: 9, size: 4, numLogs: 1, lastLogNum: 9 });
    await list;

    const pr = client.download(9);
    const assertion = expect(pr).rejects.toMatchObject({ name: 'LogError', reason: 'timeout' });

    clock.advance(500);

    await assertion;
    expect(host.byName(LOG_REQUEST_END)).toHaveLength(1);
  });

  it('rejects download on abort and sends LOG_REQUEST_END', async () => {
    const { host, client } = setup();
    const list = client.list();
    host.emitEntry({ id: 5, size: 4, numLogs: 1, lastLogNum: 5 });
    await list;

    const abort = new AbortController();
    const pr = client.download(5, undefined, abort.signal);
    const assertion = expect(pr).rejects.toMatchObject({ name: 'LogError', reason: 'aborted' });

    abort.abort();

    await assertion;
    expect(host.byName(LOG_REQUEST_END)).toHaveLength(1);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { client } = setup();
    const abort = new AbortController();
    abort.abort();

    await expect(client.list(abort.signal)).rejects.toMatchObject({
      name: 'LogError',
      reason: 'aborted',
    });
  });
});
