/**
 * MAVLink message-registry tests (task T1.4; spec plan/03 §3.3/§3.2).
 *
 * Built against synthetic `DecodedMessage` objects — the registry depends only
 * on the FROZEN `DecodedMessage` type, not the codec implementation. Covers
 * rate estimation with an injected clock, last-seen, ring eviction, multi-
 * (sysid,compid) routing isolation, wrap-aware seq-gap loss accounting
 * (duplicate / out-of-order included), and name↔id resolution.
 */
import { describe, expect, it } from 'vitest';
import type { DecodedMessage, DialectTable } from '../../src/contracts';
import {
  LinkLossTracker,
  MessageRegistry,
  RingBuffer,
  SlidingWindowRate,
  createDialectResolver,
} from '../../src/mavlink/registry';
import commonJson from '../../src/mavlink/dialects/generated/common.json';

const common = commonJson as unknown as DialectTable;

interface MsgInit {
  sysid: number;
  compid: number;
  seq: number;
  msgId: number;
  name: string;
  fields?: Record<string, number>;
}

function decoded(init: MsgInit): DecodedMessage {
  return {
    sysid: init.sysid,
    compid: init.compid,
    seq: init.seq,
    msgId: init.msgId,
    name: init.name,
    fields: init.fields ?? {},
    crcOk: true,
    signed: false,
    rxTimeUs: 0,
    raw: new Uint8Array(0),
  };
}

/** A HEARTBEAT (id 0) from (sysid, compid) with the given seq. */
function heartbeat(sysid: number, compid: number, seq: number): DecodedMessage {
  return decoded({ sysid, compid, seq, msgId: 0, name: 'HEARTBEAT' });
}

describe('MessageRegistry — ingest, latest, count, lastSeen', () => {
  it('stores the latest message and increments count per stream', () => {
    const reg = new MessageRegistry();
    reg.ingest(
      decoded({
        sysid: 1,
        compid: 1,
        seq: 0,
        msgId: 0,
        name: 'HEARTBEAT',
        fields: { custom_mode: 1 },
      }),
      1000,
    );
    reg.ingest(
      decoded({
        sysid: 1,
        compid: 1,
        seq: 1,
        msgId: 0,
        name: 'HEARTBEAT',
        fields: { custom_mode: 2 },
      }),
      1100,
    );

    const latest = reg.latest('HEARTBEAT', 1, 1);
    expect(latest?.fields.custom_mode).toBe(2);
    expect(reg.count('HEARTBEAT', 1, 1)).toBe(2);
  });

  it('reports last-seen in the injected time domain (nowMs override)', () => {
    const reg = new MessageRegistry();
    reg.ingest(heartbeat(1, 1, 0), 5_000);
    reg.ingest(heartbeat(1, 1, 1), 7_500);
    expect(reg.lastSeen('HEARTBEAT', 1, 1)).toBe(7_500);
  });

  it('uses the injected clock when nowMs is omitted', () => {
    let t = 42_000;
    const reg = new MessageRegistry({ clock: () => t });
    reg.ingest(heartbeat(1, 1, 0));
    t = 43_000;
    reg.ingest(heartbeat(1, 1, 1));
    expect(reg.lastSeen('HEARTBEAT', 1, 1)).toBe(43_000);
  });

  it('returns undefined / 0 for never-seen streams', () => {
    const reg = new MessageRegistry();
    expect(reg.latest('HEARTBEAT')).toBeUndefined();
    expect(reg.lastSeen('HEARTBEAT')).toBeUndefined();
    expect(reg.rate('HEARTBEAT')).toBe(0);
    expect(reg.count('HEARTBEAT')).toBe(0);
    expect(reg.getRing('HEARTBEAT')).toEqual([]);
  });
});

describe('MessageRegistry — observed rate with an injected clock', () => {
  it('computes ~10 Hz for a steady 100 ms stream', () => {
    const reg = new MessageRegistry({ rateWindowMs: 5_000 });
    for (let i = 0; i <= 10; i++) {
      reg.ingest(heartbeat(1, 1, i), i * 100);
    }
    // 11 samples spanning 1000 ms → 10 intervals / 1.0 s = 10 Hz.
    expect(reg.rate('HEARTBEAT', 1, 1)).toBeCloseTo(10, 6);
  });

  it('is 0 after a single sample', () => {
    const reg = new MessageRegistry();
    reg.ingest(heartbeat(1, 1, 0), 0);
    expect(reg.rate('HEARTBEAT', 1, 1)).toBe(0);
  });

  it('drops samples that fall outside the sliding window', () => {
    const rate = new SlidingWindowRate(1_000, 64);
    rate.add(0);
    rate.add(5_000); // 5 s later: the t=0 sample is evicted → only one in-window
    expect(rate.value()).toBe(0);
    rate.add(5_100);
    rate.add(5_200); // 3 samples over 200 ms → 2 / 0.2 s = 10 Hz
    expect(rate.value()).toBeCloseTo(10, 6);
  });
});

describe('RingBuffer / getRing — bounded eviction at capacity', () => {
  it('keeps only the last N frames (oldest evicted)', () => {
    const reg = new MessageRegistry({ ringCapacity: 3 });
    for (let i = 0; i < 6; i++) {
      reg.ingest(
        decoded({ sysid: 1, compid: 1, seq: i, msgId: 30, name: 'ATTITUDE', fields: { roll: i } }),
        i,
      );
    }
    const ring = reg.getRing('ATTITUDE', 1, 1);
    expect(ring).toHaveLength(3);
    expect(ring.map((m) => m.fields.roll)).toEqual([3, 4, 5]);
  });

  it('defaults to a capacity of 20', () => {
    const reg = new MessageRegistry();
    for (let i = 0; i < 25; i++) reg.ingest(heartbeat(1, 1, i), i);
    expect(reg.getRing('HEARTBEAT', 1, 1)).toHaveLength(20);
  });

  it('RingBuffer rejects an invalid capacity', () => {
    expect(() => new RingBuffer<number>(0)).toThrow(RangeError);
  });
});

describe('MessageRegistry — multi-(sysid,compid) routing isolation', () => {
  it('keeps per-source latest/count/rate separate', () => {
    const reg = new MessageRegistry({ rateWindowMs: 5_000 });
    // Source A: 2 heartbeats. Source B (different compid): 1.
    reg.ingest(
      decoded({
        sysid: 1,
        compid: 1,
        seq: 0,
        msgId: 0,
        name: 'HEARTBEAT',
        fields: { custom_mode: 11 },
      }),
      0,
    );
    reg.ingest(
      decoded({
        sysid: 1,
        compid: 1,
        seq: 1,
        msgId: 0,
        name: 'HEARTBEAT',
        fields: { custom_mode: 12 },
      }),
      100,
    );
    reg.ingest(
      decoded({
        sysid: 2,
        compid: 1,
        seq: 0,
        msgId: 0,
        name: 'HEARTBEAT',
        fields: { custom_mode: 99 },
      }),
      50,
    );

    expect(reg.latest('HEARTBEAT', 1, 1)?.fields.custom_mode).toBe(12);
    expect(reg.latest('HEARTBEAT', 2, 1)?.fields.custom_mode).toBe(99);
    expect(reg.count('HEARTBEAT', 1, 1)).toBe(2);
    expect(reg.count('HEARTBEAT', 2, 1)).toBe(1);
    expect(reg.rate('HEARTBEAT', 2, 1)).toBe(0); // single sample
  });

  it('without sysid/compid resolves to the most recently seen stream', () => {
    const reg = new MessageRegistry();
    reg.ingest(
      decoded({
        sysid: 1,
        compid: 1,
        seq: 0,
        msgId: 0,
        name: 'HEARTBEAT',
        fields: { custom_mode: 1 },
      }),
      100,
    );
    reg.ingest(
      decoded({
        sysid: 7,
        compid: 1,
        seq: 0,
        msgId: 0,
        name: 'HEARTBEAT',
        fields: { custom_mode: 2 },
      }),
      500,
    );
    expect(reg.latest('HEARTBEAT')?.fields.custom_mode).toBe(2); // sysid 7 seen later
  });

  it('listSystems returns distinct sources sorted ascending', () => {
    const reg = new MessageRegistry();
    reg.ingest(heartbeat(2, 1, 0), 0);
    reg.ingest(heartbeat(1, 1, 0), 0);
    reg.ingest(heartbeat(1, 1, 1), 1); // duplicate source
    reg.ingest(heartbeat(1, 190, 0), 0);
    expect(reg.listSystems()).toEqual([
      { sysid: 1, compid: 1 },
      { sysid: 1, compid: 190 },
      { sysid: 2, compid: 1 },
    ]);
  });
});

describe('LinkLossTracker / linkStats — sequence-gap accounting', () => {
  it('reports no loss for an in-order stream', () => {
    const reg = new MessageRegistry();
    for (let i = 0; i < 5; i++) reg.ingest(heartbeat(1, 1, i), i);
    const stats = reg.linkStats(1, 1);
    expect(stats?.received).toBe(5);
    expect(stats?.lost).toBe(0);
    expect(stats?.lossPct).toBe(0);
    expect(stats?.lastSeq).toBe(4);
  });

  it('counts missing frames in a forward gap', () => {
    const reg = new MessageRegistry();
    reg.ingest(heartbeat(1, 1, 5), 0);
    reg.ingest(heartbeat(1, 1, 8), 1); // 6 and 7 missing
    const stats = reg.linkStats(1, 1);
    expect(stats?.lost).toBe(2);
    expect(stats?.received).toBe(2);
    expect(stats?.lossPct).toBeCloseTo((2 / 4) * 100, 6);
  });

  it('handles the 255 → 0 wraparound with no false loss', () => {
    const reg = new MessageRegistry();
    for (const seq of [253, 254, 255, 0, 1]) reg.ingest(heartbeat(1, 1, seq), 0);
    const stats = reg.linkStats(1, 1);
    expect(stats?.lost).toBe(0);
    expect(stats?.lastSeq).toBe(1);
  });

  it('counts loss across the wraparound boundary', () => {
    const reg = new MessageRegistry();
    reg.ingest(heartbeat(1, 1, 254), 0);
    reg.ingest(heartbeat(1, 1, 1), 1); // 255 and 0 missing
    expect(reg.linkStats(1, 1)?.lost).toBe(2);
  });

  it('treats a repeated seq as a duplicate, not loss', () => {
    const reg = new MessageRegistry();
    reg.ingest(heartbeat(1, 1, 10), 0);
    reg.ingest(heartbeat(1, 1, 10), 1);
    const stats = reg.linkStats(1, 1);
    expect(stats?.duplicates).toBe(1);
    expect(stats?.lost).toBe(0);
    expect(stats?.lastSeq).toBe(10);
  });

  it('treats a backwards seq as out-of-order, keeping lastSeq', () => {
    const reg = new MessageRegistry();
    reg.ingest(heartbeat(1, 1, 20), 0);
    reg.ingest(heartbeat(1, 1, 18), 1); // late/reordered
    reg.ingest(heartbeat(1, 1, 21), 2); // continues in order from 20
    const stats = reg.linkStats(1, 1);
    expect(stats?.outOfOrder).toBe(1);
    expect(stats?.lost).toBe(0);
    expect(stats?.lastSeq).toBe(21);
  });

  it('accounts loss across all message ids on the same source', () => {
    const reg = new MessageRegistry();
    reg.ingest(decoded({ sysid: 1, compid: 1, seq: 0, msgId: 0, name: 'HEARTBEAT' }), 0);
    reg.ingest(decoded({ sysid: 1, compid: 1, seq: 3, msgId: 30, name: 'ATTITUDE' }), 1); // 1,2 missing
    expect(reg.linkStats(1, 1)?.lost).toBe(2);
  });

  it('isolates loss accounting per (sysid, compid)', () => {
    const reg = new MessageRegistry();
    reg.ingest(heartbeat(1, 1, 0), 0);
    reg.ingest(heartbeat(1, 1, 5), 1); // source A: 4 lost
    reg.ingest(heartbeat(2, 1, 0), 0);
    reg.ingest(heartbeat(2, 1, 1), 1); // source B: 0 lost
    expect(reg.linkStats(1, 1)?.lost).toBe(4);
    expect(reg.linkStats(2, 1)?.lost).toBe(0);
    expect(reg.listLinkStats().map((s) => [s.sysid, s.compid])).toEqual([
      [1, 1],
      [2, 1],
    ]);
  });

  it('LinkLossTracker can be used directly', () => {
    const t = new LinkLossTracker(3, 1);
    t.observe(0);
    t.observe(2); // 1 missing
    expect(t.stats()).toMatchObject({ sysid: 3, compid: 1, received: 2, lost: 1 });
  });
});

describe('MessageRegistry — name ↔ id resolution', () => {
  it('resolves by name from observed traffic (no resolver needed)', () => {
    const reg = new MessageRegistry();
    reg.ingest(
      decoded({ sysid: 1, compid: 1, seq: 0, msgId: 30, name: 'ATTITUDE', fields: { roll: 0.5 } }),
      0,
    );
    expect(reg.latest('ATTITUDE', 1, 1)?.fields.roll).toBe(0.5);
    expect(reg.latest(30, 1, 1)?.fields.roll).toBe(0.5); // by numeric id too
    expect(reg.idOf('ATTITUDE')).toBe(30);
    expect(reg.nameOf(30)).toBe('ATTITUDE');
  });

  it('resolves names not yet seen via an injected dialect resolver', () => {
    const reg = new MessageRegistry({ resolver: createDialectResolver([common]) });
    // Nothing ingested yet, but the dialect knows HEARTBEAT is id 0.
    expect(reg.idOf('HEARTBEAT')).toBe(0);
    expect(reg.nameOf(0)).toBe('HEARTBEAT');
    expect(reg.latest('HEARTBEAT')).toBeUndefined(); // resolved but never seen
  });

  it('createDialectResolver maps known names/ids', () => {
    const resolver = createDialectResolver([common]);
    expect(resolver.idOf('HEARTBEAT')).toBe(0);
    expect(resolver.nameOf(0)).toBe('HEARTBEAT');
    expect(resolver.idOf('NOT_A_REAL_MESSAGE')).toBeUndefined();
  });
});

describe('MessageRegistry — snapshot / forEach / getRecord / clear', () => {
  it('snapshot returns sorted records with copied rings', () => {
    const reg = new MessageRegistry();
    reg.ingest(decoded({ sysid: 2, compid: 1, seq: 0, msgId: 30, name: 'ATTITUDE' }), 0);
    reg.ingest(heartbeat(1, 1, 0), 0);
    const snap = reg.snapshot();
    expect(snap.map((r) => [r.sysid, r.compid, r.msgId])).toEqual([
      [1, 1, 0],
      [2, 1, 30],
    ]);
    // ring is a snapshot copy, not the live buffer
    expect(Object.isFrozen(snap)).toBe(false);
    expect(snap[0]?.ring).toHaveLength(1);
  });

  it('forEach visits every record', () => {
    const reg = new MessageRegistry();
    reg.ingest(heartbeat(1, 1, 0), 0);
    reg.ingest(decoded({ sysid: 1, compid: 1, seq: 1, msgId: 30, name: 'ATTITUDE' }), 1);
    const names: string[] = [];
    reg.forEach((r) => names.push(r.name));
    expect(names.sort()).toEqual(['ATTITUDE', 'HEARTBEAT']);
  });

  it('getRecord exposes the full per-stream view', () => {
    const reg = new MessageRegistry({ rateWindowMs: 5_000 });
    reg.ingest(heartbeat(1, 1, 0), 0);
    reg.ingest(heartbeat(1, 1, 1), 100);
    const rec = reg.getRecord('HEARTBEAT', 1, 1);
    expect(rec).toMatchObject({ sysid: 1, compid: 1, msgId: 0, name: 'HEARTBEAT', count: 2 });
    expect(rec?.rateHz).toBeCloseTo(10, 6);
    expect(rec?.lastSeenMs).toBe(100);
  });

  it('clear drops all accumulated state', () => {
    const reg = new MessageRegistry();
    reg.ingest(heartbeat(1, 1, 0), 0);
    reg.clear();
    expect(reg.snapshot()).toEqual([]);
    expect(reg.listSystems()).toEqual([]);
    expect(reg.linkStats(1, 1)).toBeUndefined();
  });
});
