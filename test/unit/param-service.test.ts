import { describe, it, expect, vi } from 'vitest';
import {
  ParamClient,
  ParamError,
  createParamClient,
  type ParamClock,
  type ParamTarget,
} from '../../src/mavlink/microservices/param';
import type { DecodedMessage, FieldValue, Param } from '../../src/contracts';

// ---------------------------------------------------------------------------
// Deterministic fake clock — fires due timers in chronological order, including
// timers scheduled by an earlier timer's callback (quiet-window / retry loops).
// ---------------------------------------------------------------------------

class FakeClock implements ParamClock {
  private now = 0;
  private seq = 0;
  private readonly timers = new Map<number, { at: number; cb: () => void }>();

  setTimeout(handler: () => void, ms: number): () => void {
    const id = this.seq++;
    this.timers.set(id, { at: this.now + ms, cb: handler });
    return () => void this.timers.delete(id);
  }

  /** Advance virtual time by `ms`, firing all due callbacks in order. */
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
// Mock host: records sent messages and replays PARAM_VALUE into the tap.
// ---------------------------------------------------------------------------

type Sent = { name: string; fields: Record<string, unknown> };

class MockHost {
  readonly sent: Sent[] = [];
  private cb: ((msg: DecodedMessage) => void) | undefined;

  readonly sendMessage = (name: string, fields: Record<string, unknown>): void => {
    this.sent.push({ name, fields });
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

  /** Deliver a PARAM_VALUE. `paramId` may be a string or a char-code array. */
  emitValue(opts: {
    paramId: FieldValue;
    value: number;
    index: number;
    count: number;
    type?: number;
    sysid?: number;
    compid?: number;
  }): void {
    const fields: Record<string, FieldValue> = {
      param_id: opts.paramId,
      param_value: opts.value,
      param_type: opts.type ?? 9, // MAV_PARAM_TYPE_REAL32
      param_index: opts.index,
      param_count: opts.count,
    };
    this.cb?.({
      sysid: opts.sysid ?? 1,
      compid: opts.compid ?? 1,
      seq: 0,
      msgId: 22,
      name: 'PARAM_VALUE',
      fields,
      crcOk: true,
      signed: false,
      rxTimeUs: 0,
      raw: new Uint8Array(),
    });
  }

  byName(name: string): Sent[] {
    return this.sent.filter((s) => s.name === name);
  }
}

const TARGET: ParamTarget = { sysid: 1, compid: 1 };

function setup(extra: Partial<ConstructorParameters<typeof ParamClient>[0]> = {}): {
  host: MockHost;
  clock: FakeClock;
  client: ParamClient;
} {
  const host = new MockHost();
  const clock = new FakeClock();
  const client = createParamClient({
    sendMessage: host.sendMessage,
    onMessage: host.onMessage,
    getTarget: () => TARGET,
    clock,
    fetchQuietMs: 100,
    fetchMaxStallRounds: 3,
    setResendMs: 100,
    setMaxAttempts: 3,
    ...extra,
  });
  return { host, clock, client };
}

// ---------------------------------------------------------------------------

describe('ParamClient — fetchAll (happy path)', () => {
  it('ignores PARAM_VALUE messages from foreign systems', async () => {
    const { host, client } = setup();
    const changes: Param[] = [];
    client.onChange((p) => changes.push(p));

    const pr = client.fetchAll();
    host.emitValue({ paramId: 'FOREIGN', value: 99, index: 0, count: 1, sysid: 2 });
    expect(client.get('FOREIGN')).toBeUndefined();

    host.emitValue({ paramId: 'LOCAL', value: 7, index: 0, count: 1 });
    await expect(pr).resolves.toEqual([{ name: 'LOCAL', value: 7, type: 9 }]);
    expect(client.get('FOREIGN')).toBeUndefined();
    expect(changes).toHaveLength(0);
  });

  it('requests the list and resolves the full set with progress, ordered by index', async () => {
    const { host, client } = setup();
    const progress: Array<[number, number]> = [];
    const changes: Param[] = [];
    client.onChange((p) => changes.push(p));

    const pr = client.fetchAll((done, total) => progress.push([done, total]));
    expect(host.byName('PARAM_REQUEST_LIST')).toHaveLength(1);
    expect(host.sent[0]?.fields).toMatchObject({ target_system: 1, target_component: 1 });

    host.emitValue({ paramId: 'BRD_TYPE', value: 2, index: 2, count: 3, type: 6 });
    host.emitValue({ paramId: 'ARMING_CHECK', value: 1, index: 0, count: 3, type: 6 });
    host.emitValue({ paramId: 'RC1_MIN', value: 1100, index: 1, count: 3, type: 9 });

    const params = await pr;
    expect(params.map((p) => p.name)).toEqual(['ARMING_CHECK', 'RC1_MIN', 'BRD_TYPE']);
    expect(params.map((p) => p.value)).toEqual([1, 1100, 2]);
    expect(params.map((p) => p.type)).toEqual([6, 9, 6]);
    // Progress reported on every value, ending complete.
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    // Bulk fetch values must NOT spam onChange.
    expect(changes).toHaveLength(0);
    // Cached lookups available afterwards.
    expect(client.get('RC1_MIN')).toEqual({ name: 'RC1_MIN', value: 1100, type: 9 });
    expect(client.get('NOPE')).toBeUndefined();
  });
});

describe('ParamClient — fetchAll (forced missing index → re-request)', () => {
  it('re-requests dropped indices after the quiet window, then completes', async () => {
    const { host, clock, client } = setup();
    const pr = client.fetchAll();

    // total = 4 but index 1 and 3 are DROPPED from the initial stream.
    host.emitValue({ paramId: 'P0', value: 10, index: 0, count: 4 });
    host.emitValue({ paramId: 'P2', value: 12, index: 2, count: 4 });
    expect(host.byName('PARAM_REQUEST_READ')).toHaveLength(0);

    // Quiet window elapses → re-request the two missing indices.
    clock.advance(100);
    const reads = host.byName('PARAM_REQUEST_READ');
    expect(reads.map((r) => r.fields.param_index).sort()).toEqual([1, 3]);
    expect(reads[0]?.fields).toMatchObject({ target_system: 1, target_component: 1, param_id: '' });

    // The vehicle now answers the gap requests.
    host.emitValue({ paramId: 'P1', value: 11, index: 1, count: 4 });
    host.emitValue({ paramId: 'P3', value: 13, index: 3, count: 4 });

    const params = await pr;
    expect(params.map((p) => p.name)).toEqual(['P0', 'P1', 'P2', 'P3']);
  });

  it('re-broadcasts PARAM_REQUEST_LIST when no values arrive at all', async () => {
    const { host, clock, client } = setup();
    const pr = client.fetchAll();
    pr.catch(() => undefined); // avoid unhandled-rejection noise; asserted below

    expect(host.byName('PARAM_REQUEST_LIST')).toHaveLength(1);
    clock.advance(100); // first quiet window, still nothing → re-broadcast
    expect(host.byName('PARAM_REQUEST_LIST').length).toBeGreaterThanOrEqual(2);

    // Eventually a value arrives and the fetch completes.
    host.emitValue({ paramId: 'ONLY', value: 7, index: 0, count: 1 });
    await expect(pr).resolves.toEqual([{ name: 'ONLY', value: 7, type: 9 }]);
  });
});

describe('ParamClient — fetchAll (timeout / abort)', () => {
  it('rejects with a timeout after the stall bound elapses', async () => {
    const { clock, client } = setup({ fetchMaxStallRounds: 2 });
    const pr = client.fetchAll();
    const assertion = expect(pr).rejects.toMatchObject({
      name: 'ParamError',
      reason: 'timeout',
    });
    clock.advance(100 * 10); // several stalled quiet windows
    await assertion;
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { client } = setup();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(client.fetchAll(undefined, ctrl.signal)).rejects.toMatchObject({
      reason: 'aborted',
    });
  });

  it('rejects when a mid-flight abort fires', async () => {
    const { host, client } = setup();
    const ctrl = new AbortController();
    const pr = client.fetchAll(undefined, ctrl.signal);
    host.emitValue({ paramId: 'P0', value: 1, index: 0, count: 5 });
    ctrl.abort();
    await expect(pr).rejects.toMatchObject({ reason: 'aborted' });
  });

  it('rejects with no-target when there is no active vehicle', async () => {
    const host = new MockHost();
    const client = createParamClient({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getTarget: () => undefined,
    });
    await expect(client.fetchAll()).rejects.toMatchObject({ reason: 'no-target' });
  });
});

describe('ParamClient — set', () => {
  it('emits PARAM_SET, confirms on the echo, updates cache and fires onChange', async () => {
    const { host, client } = setup();
    const changes: Param[] = [];
    client.onChange((p) => changes.push(p));

    const pr = client.set('RC1_MIN', 1100);
    const sets = host.byName('PARAM_SET');
    expect(sets).toHaveLength(1);
    expect(sets[0]?.fields).toMatchObject({
      param_id: 'RC1_MIN',
      param_value: 1100,
      param_type: 9, // REAL32 default for an uncached param
      target_system: 1,
      target_component: 1,
    });

    host.emitValue({ paramId: 'RC1_MIN', value: 1100, index: 0, count: 1, type: 9 });
    await expect(pr).resolves.toBeUndefined();

    expect(client.get('RC1_MIN')).toEqual({ name: 'RC1_MIN', value: 1100, type: 9 });
    expect(changes).toEqual([{ name: 'RC1_MIN', value: 1100, type: 9 }]);
  });

  it('uses the cached MAV_PARAM_TYPE when the parameter is known', async () => {
    const { host, client } = setup();
    // Prime the cache with an int parameter via a spontaneous value.
    host.emitValue({ paramId: 'ARMING_CHECK', value: 1, index: 0, count: 1, type: 6 });

    const pr = client.set('ARMING_CHECK', 0);
    expect(host.byName('PARAM_SET')[0]?.fields).toMatchObject({ param_type: 6, param_value: 0 });
    host.emitValue({ paramId: 'ARMING_CHECK', value: 0, index: 0, count: 1, type: 6 });
    await pr;
    expect(client.get('ARMING_CHECK')?.value).toBe(0);
  });

  it('resends on the timer and rejects with a timeout after the attempt bound', async () => {
    const { host, clock, client } = setup();
    const pr = client.set('RC1_MIN', 1500);
    const assertion = expect(pr).rejects.toMatchObject({ reason: 'timeout', param: 'RC1_MIN' });

    clock.advance(100); // attempt 2
    clock.advance(100); // attempt 3
    expect(host.byName('PARAM_SET').length).toBe(3);
    clock.advance(100); // exhausted → reject
    await assertion;
  });

  it('rejects no-target / send-failed appropriately', async () => {
    const host = new MockHost();
    const noTarget = createParamClient({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getTarget: () => undefined,
    });
    await expect(noTarget.set('X', 1)).rejects.toMatchObject({ reason: 'no-target' });

    const failing = createParamClient({
      sendMessage: () => {
        throw new Error('wire down');
      },
      onMessage: host.onMessage,
      getTarget: () => TARGET,
    });
    await expect(failing.set('Y', 2)).rejects.toMatchObject({ reason: 'send-failed', param: 'Y' });
  });
});

describe('ParamClient — param_id parsing + onChange', () => {
  it('NUL-trims a short param_id and reads exactly 16 chars without a terminator', () => {
    const { host, client } = setup();
    host.emitValue({ paramId: 'ABC\u0000\u0000\u0000', value: 5, index: 0, count: 2 });
    host.emitValue({ paramId: 'ABCDEFGHIJKLMNOP', value: 6, index: 1, count: 2 });

    expect(client.get('ABC')).toEqual({ name: 'ABC', value: 5, type: 9 });
    expect(client.get('ABCDEFGHIJKLMNOP')).toEqual({
      name: 'ABCDEFGHIJKLMNOP',
      value: 6,
      type: 9,
    });
  });

  it('accepts a raw char-code array param_id (defensive decode)', () => {
    const { host, client } = setup();
    const codes = [...'SR0_RAW'].map((c) => c.charCodeAt(0));
    codes.push(0, 0); // trailing NULs
    host.emitValue({ paramId: codes, value: 4, index: 0, count: 1 });
    expect(client.get('SR0_RAW')).toEqual({ name: 'SR0_RAW', value: 4, type: 9 });
  });

  it('fires onChange for a spontaneous value change but not for an unchanged echo', () => {
    const { host, client } = setup();
    const cb = vi.fn();
    client.onChange(cb);

    host.emitValue({ paramId: 'FOO', value: 1, index: 0, count: 1 }); // new
    host.emitValue({ paramId: 'FOO', value: 1, index: 0, count: 1 }); // unchanged
    host.emitValue({ paramId: 'FOO', value: 2, index: 0, count: 1 }); // changed

    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb).toHaveBeenNthCalledWith(1, { name: 'FOO', value: 1, type: 9 });
    expect(cb).toHaveBeenNthCalledWith(2, { name: 'FOO', value: 2, type: 9 });
  });

  it('dispose rejects in-flight operations and stops the tap', async () => {
    const { host, client } = setup();
    const pr = client.fetchAll();
    client.dispose();
    await expect(pr).rejects.toMatchObject({ reason: 'disposed' });
    // After dispose, further values are ignored (no throw).
    expect(() => host.emitValue({ paramId: 'X', value: 1, index: 0, count: 1 })).not.toThrow();
  });
});

describe('ParamError', () => {
  it('is an Error subclass carrying a typed reason', () => {
    const e = new ParamError('boom', 'timeout', 'P');
    expect(e).toBeInstanceOf(Error);
    expect(e.name).toBe('ParamError');
    expect(e.reason).toBe('timeout');
    expect(e.param).toBe('P');
  });
});
