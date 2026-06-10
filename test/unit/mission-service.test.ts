import { describe, it, expect } from 'vitest';
import {
  MissionClient,
  MissionError,
  createMissionClient,
  type MissionClock,
  type MissionTarget,
} from '../../src/mavlink/microservices/mission';
import type { DecodedMessage, FieldValue, Mission, MissionItem } from '../../src/contracts';

// ---------------------------------------------------------------------------
// Deterministic fake clock — fires due timers in chronological order, including
// timers scheduled by an earlier timer's callback (per-item retry loop).
// ---------------------------------------------------------------------------

class FakeClock implements MissionClock {
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
// Mock host: records sent messages and replays MISSION_* into the single tap.
// ---------------------------------------------------------------------------

type Sent = { name: string; fields: Record<string, unknown> };

const MT = { mission: 0, fence: 1, rally: 2 } as const;
const ACCEPTED = 0;
const ERROR = 1;

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

  private deliver(
    name: string,
    msgId: number,
    fields: Record<string, FieldValue>,
    raw = new Uint8Array(),
  ): void {
    this.cb?.({
      sysid: typeof fields.__sysid === 'number' ? fields.__sysid : 1,
      compid: 1,
      seq: 0,
      msgId,
      name,
      fields,
      crcOk: true,
      signed: false,
      rxTimeUs: 0,
      raw,
    });
  }

  emitCount(count: number, missionType = 0, sysid = 1): void {
    this.deliver('MISSION_COUNT', 44, {
      count,
      target_system: 255,
      target_component: 0,
      mission_type: missionType,
      __sysid: sysid,
    });
  }

  emitItemInt(item: MissionItem, missionType = 0, sysid = 1): void {
    this.deliver('MISSION_ITEM_INT', 73, {
      seq: item.seq,
      frame: item.frame,
      command: item.command,
      current: item.current,
      autocontinue: item.autocontinue,
      param1: item.params[0],
      param2: item.params[1],
      param3: item.params[2],
      param4: item.params[3],
      x: item.x,
      y: item.y,
      z: item.z,
      target_system: 255,
      target_component: 0,
      mission_type: missionType,
      __sysid: sysid,
    });
  }

  emitRequestInt(seq: number, missionType = 0, sysid = 1): void {
    this.deliver('MISSION_REQUEST_INT', 51, {
      seq,
      target_system: 255,
      target_component: 0,
      mission_type: missionType,
      __sysid: sysid,
    });
  }

  emitRequest(seq: number, missionType = 0, sysid = 1): void {
    this.deliver('MISSION_REQUEST', 40, {
      seq,
      target_system: 255,
      target_component: 0,
      mission_type: missionType,
      __sysid: sysid,
    });
  }

  emitAck(result: number, missionType = 0, sysid = 1, raw = new Uint8Array()): void {
    this.deliver(
      'MISSION_ACK',
      47,
      {
        target_system: 255,
        target_component: 0,
        type: result,
        mission_type: missionType,
        __sysid: sysid,
      },
      raw,
    );
  }

  emitCurrent(seq: number): void {
    this.deliver('MISSION_CURRENT', 42, { seq, total: 0, mission_state: 0, mission_mode: 0 });
  }

  emitReached(seq: number): void {
    this.deliver('MISSION_ITEM_REACHED', 46, { seq });
  }

  byName(name: string): Sent[] {
    return this.sent.filter((s) => s.name === name);
  }
}

// ---------------------------------------------------------------------------

function makeItem(seq: number, overrides: Partial<MissionItem> = {}): MissionItem {
  return {
    seq,
    frame: 3,
    command: 16, // MAV_CMD_NAV_WAYPOINT
    current: seq === 0 ? 1 : 0,
    autocontinue: 1,
    params: [0, 0, 0, 0],
    x: Math.round((-35.36 + seq * 0.001) * 1e7),
    y: Math.round((149.16 + seq * 0.001) * 1e7),
    z: 50 + seq,
    ...overrides,
  };
}

const TARGET: MissionTarget = { sysid: 1, compid: 1 };

function setup(extra: Partial<ConstructorParameters<typeof MissionClient>[0]> = {}) {
  const host = new MockHost();
  const clock = new FakeClock();
  const client = createMissionClient({
    sendMessage: host.sendMessage,
    onMessage: host.onMessage,
    getTarget: () => TARGET,
    clock,
    resendMs: 1500,
    maxAttempts: 4,
    ...extra,
  });
  return { host, clock, client };
}

// ---------------------------------------------------------------------------

describe('MissionClient — download', () => {
  it('REQUEST_LIST -> COUNT -> ITEM_INTs -> ACK yields the items', async () => {
    const { host, client } = setup();
    const items = [makeItem(0), makeItem(1), makeItem(2)];
    const progress: Array<[number, number]> = [];
    const pr = client.download('mission', (i, n) => progress.push([i, n]));

    expect(host.byName('MISSION_REQUEST_LIST')).toHaveLength(1);
    expect(host.sent[0]?.fields).toMatchObject({
      target_system: 1,
      target_component: 1,
      mission_type: 0,
    });

    host.emitCount(items.length);
    expect(host.byName('MISSION_REQUEST_INT')).toHaveLength(1);
    expect(host.byName('MISSION_REQUEST_INT')[0]?.fields).toMatchObject({
      seq: 0,
      mission_type: 0,
    });

    host.emitItemInt(items[0]!);
    expect(host.byName('MISSION_REQUEST_INT')[1]?.fields).toMatchObject({ seq: 1 });
    host.emitItemInt(items[1]!);
    host.emitItemInt(items[2]!);

    // Final handshake ACK sent by the GCS.
    expect(host.byName('MISSION_ACK')).toHaveLength(1);
    expect(host.byName('MISSION_ACK')[0]?.fields).toMatchObject({
      type: ACCEPTED,
      mission_type: 0,
    });

    const mission = await pr;
    expect(mission.type).toBe('mission');
    expect(mission.items).toEqual(items);
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('resolves an empty mission on COUNT = 0 (and acks)', async () => {
    const { host, client } = setup();
    const pr = client.download('mission');
    host.emitCount(0);
    expect(host.byName('MISSION_ACK')).toHaveLength(1);
    await expect(pr).resolves.toEqual({ type: 'mission', items: [] });
  });

  it('retries the current item request when an ITEM_INT is dropped', async () => {
    const { host, clock, client } = setup();
    const items = [makeItem(0), makeItem(1)];
    const pr = client.download('mission');

    host.emitCount(2);
    host.emitItemInt(items[0]!); // seq 0 ok -> requests seq 1
    expect(host.byName('MISSION_REQUEST_INT')).toHaveLength(2);

    // Drop seq 1 -> a timeout resends MISSION_REQUEST_INT(seq=1).
    clock.advance(1500);
    const reqs = host.byName('MISSION_REQUEST_INT');
    expect(reqs).toHaveLength(3);
    expect(reqs[2]?.fields).toMatchObject({ seq: 1 });

    host.emitItemInt(items[1]!);
    const mission = await pr;
    expect(mission.items).toEqual(items);
  });

  it('times out after maxAttempts when an item never arrives', async () => {
    const { host, clock, client } = setup({ maxAttempts: 3 });
    const caught = client.download('mission').catch((e: unknown) => e);
    host.emitCount(1);
    clock.advance(1500); // attempt 2
    clock.advance(1500); // attempt 3
    clock.advance(1500); // exhausted -> timeout
    const err = await caught;
    expect(err).toBeInstanceOf(MissionError);
    expect((err as MissionError).reason).toBe('timeout');
  });
});

describe('MissionClient — upload', () => {
  it('COUNT -> REQUEST_INTs -> ACK accepted sends the correct items', async () => {
    const { host, client } = setup();
    const items = [makeItem(0), makeItem(1), makeItem(2)];
    const progress: Array<[number, number]> = [];
    const pr = client.upload(
      { type: 'mission', items },
      { onProgress: (i, n) => progress.push([i, n]) },
    );

    const count = host.byName('MISSION_COUNT');
    expect(count).toHaveLength(1);
    expect(count[0]?.fields).toMatchObject({ count: 3, target_system: 1, mission_type: 0 });

    host.emitRequestInt(0);
    host.emitRequestInt(1);
    host.emitRequestInt(2);

    const sentItems = host.byName('MISSION_ITEM_INT');
    expect(sentItems).toHaveLength(3);
    expect(sentItems[0]?.fields).toMatchObject({
      seq: 0,
      command: 16,
      x: items[0]!.x,
      y: items[0]!.y,
      z: items[0]!.z,
      param1: 0,
      mission_type: 0,
    });
    expect(sentItems[2]?.fields).toMatchObject({ seq: 2 });

    host.emitAck(ACCEPTED);
    await expect(pr).resolves.toBeUndefined();
    expect(progress).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it('answers the legacy MISSION_REQUEST (float) with a MISSION_ITEM_INT', async () => {
    const { host, client } = setup();
    const items = [makeItem(0)];
    const pr = client.upload({ type: 'mission', items });
    host.emitRequest(0); // legacy request
    expect(host.byName('MISSION_ITEM_INT')).toHaveLength(1);
    host.emitAck(ACCEPTED);
    await expect(pr).resolves.toBeUndefined();
  });

  it('rejects on a non-ACCEPTED ACK result', async () => {
    const { host, client } = setup();
    const items = [makeItem(0)];
    const caught = client.upload({ type: 'mission', items }).catch((e: unknown) => e);
    host.emitRequestInt(0);
    host.emitAck(ERROR);
    const err = await caught;
    expect(err).toBeInstanceOf(MissionError);
    expect((err as MissionError).reason).toBe('rejected');
    expect((err as MissionError).result).toBe(ERROR);
  });

  it('resends MISSION_COUNT when no request arrives, then times out', async () => {
    const { host, clock, client } = setup({ maxAttempts: 3 });
    const caught = client
      .upload({ type: 'mission', items: [makeItem(0)] })
      .catch((e: unknown) => e);
    clock.advance(1500); // resend COUNT (attempt 2)
    clock.advance(1500); // resend COUNT (attempt 3)
    expect(host.byName('MISSION_COUNT')).toHaveLength(3);
    clock.advance(1500); // exhausted
    expect(((await caught) as MissionError).reason).toBe('timeout');
  });

  it('re-downloads and compares when verify is set', async () => {
    const { host, client } = setup();
    const items = [makeItem(0), makeItem(1)];
    const pr = client.upload({ type: 'mission', items }, { verify: true });

    host.emitRequestInt(0);
    host.emitRequestInt(1);
    host.emitAck(ACCEPTED); // accepted -> triggers verify download

    // The verify download starts immediately (REQUEST_LIST sent).
    expect(host.byName('MISSION_REQUEST_LIST')).toHaveLength(1);
    host.emitCount(2);
    // Vehicle re-flags item 0 as not-current on read-back: verify must ignore it.
    host.emitItemInt({ ...items[0]!, current: 0 });
    host.emitItemInt(items[1]!);

    await expect(pr).resolves.toBeUndefined();
  });

  it('verify rejects when the read-back differs', async () => {
    const { host, client } = setup();
    const items = [makeItem(0), makeItem(1)];
    const caught = client
      .upload({ type: 'mission', items }, { verify: true })
      .catch((e: unknown) => e);

    host.emitRequestInt(0);
    host.emitRequestInt(1);
    host.emitAck(ACCEPTED);

    host.emitCount(2);
    host.emitItemInt(items[0]!);
    host.emitItemInt({ ...items[1]!, z: items[1]!.z + 100 }); // altered geometry

    const err = await caught;
    expect(err).toBeInstanceOf(MissionError);
    expect((err as MissionError).reason).toBe('verify');
  });
});

describe('MissionClient — mission types', () => {
  it.each(['fence', 'rally'] as const)(
    'round-trips %s items with the right mission_type',
    async (type) => {
      const mt = MT[type];
      const { host, client } = setup();
      const items = [makeItem(0), makeItem(1)];

      // Upload tags every message with mission_type.
      const up = client.upload({ type, items } as Mission);
      expect(host.byName('MISSION_COUNT')[0]?.fields).toMatchObject({ mission_type: mt });
      host.emitRequestInt(0, mt);
      host.emitRequestInt(1, mt);
      expect(host.byName('MISSION_ITEM_INT')[0]?.fields).toMatchObject({ mission_type: mt });
      host.emitAck(ACCEPTED, mt);
      await up;

      // Download requests the same mission_type and resolves typed items.
      const dl = client.download(type);
      expect(host.byName('MISSION_REQUEST_LIST').at(-1)?.fields).toMatchObject({
        mission_type: mt,
      });
      host.emitCount(2, mt);
      expect(host.byName('MISSION_REQUEST_INT').at(-1)?.fields).toMatchObject({ mission_type: mt });
      host.emitItemInt(items[0]!, mt);
      host.emitItemInt(items[1]!, mt);
      const mission = await dl;
      expect(mission.type).toBe(type);
      expect(mission.items).toEqual(items);
    },
  );

  it('matches a MAVLink v1 fence upload ACK with zero-filled mission_type', async () => {
    const { host, client } = setup();
    const items = [makeItem(0)];
    const pr = client.upload({ type: 'fence', items });

    host.emitRequestInt(0, MT.fence);
    host.emitAck(ACCEPTED, MT.mission, 1, new Uint8Array([0xfe]));

    await expect(pr).resolves.toBeUndefined();
  });

  it('ignores a COUNT for a different mission_type', async () => {
    const { host, client } = setup();
    const pr = client.download('fence');
    host.emitCount(3, MT.mission); // wrong type
    expect(host.byName('MISSION_REQUEST_INT')).toHaveLength(0);
    host.emitCount(1, MT.fence); // correct type drives it
    host.emitItemInt(makeItem(0), MT.fence);
    await expect(pr).resolves.toMatchObject({ type: 'fence' });
  });
});

describe('MissionClient — clear / setCurrent / events', () => {
  it('clear sends MISSION_CLEAR_ALL and resolves on an accepted ACK', async () => {
    const { host, client } = setup();
    const pr = client.clear('rally');
    expect(host.byName('MISSION_CLEAR_ALL')[0]?.fields).toMatchObject({
      target_system: 1,
      mission_type: MT.rally,
    });
    host.emitAck(ACCEPTED, MT.rally);
    await expect(pr).resolves.toBeUndefined();
  });

  it('clear rejects on a non-accepted ACK', async () => {
    const { host, client } = setup();
    const caught = client.clear('mission').catch((e: unknown) => e);
    host.emitAck(ERROR, MT.mission);
    expect(((await caught) as MissionError).reason).toBe('rejected');
  });

  it('setCurrent sends MISSION_SET_CURRENT (fire-and-forget)', async () => {
    const { host, client } = setup();
    await client.setCurrent(4);
    expect(host.byName('MISSION_SET_CURRENT')[0]).toEqual({
      name: 'MISSION_SET_CURRENT',
      fields: { target_system: 1, target_component: 1, seq: 4 },
    });
  });

  it('onCurrent / onReached surface the vehicle events', () => {
    const { host, client } = setup();
    const current: number[] = [];
    const reached: number[] = [];
    const offC = client.onCurrent((s) => current.push(s));
    const offR = client.onReached((s) => reached.push(s));

    host.emitCurrent(2);
    host.emitReached(2);
    host.emitCurrent(3);
    expect(current).toEqual([2, 3]);
    expect(reached).toEqual([2]);

    offC();
    offR();
    host.emitCurrent(9);
    expect(current).toEqual([2, 3]); // unsubscribed
  });
});

describe('MissionClient — guards', () => {
  it('rejects download/upload/clear when there is no target', async () => {
    const host = new MockHost();
    const client = createMissionClient({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getTarget: () => undefined,
    });
    expect(
      ((await client.download('mission').catch((e: unknown) => e)) as MissionError).reason,
    ).toBe('no-target');
    expect(
      (
        (await client
          .upload({ type: 'mission', items: [] })
          .catch((e: unknown) => e)) as MissionError
      ).reason,
    ).toBe('no-target');
    expect(((await client.clear('mission').catch((e: unknown) => e)) as MissionError).reason).toBe(
      'no-target',
    );
  });

  it('rejects when already aborted', async () => {
    const { client } = setup();
    const err = await client
      .download('mission', undefined, AbortSignal.abort())
      .catch((e: unknown) => e);
    expect((err as MissionError).reason).toBe('aborted');
  });
});
