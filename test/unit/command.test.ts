import { describe, it, expect } from 'vitest';
import {
  CommandClient,
  CommandError,
  createCommandClient,
  type ActiveVehicle,
  type CommandClock,
} from '../../src/mavlink/microservices/command';
import type { DecodedMessage, FieldValue, VehicleClass } from '../../src/contracts';

// ---------------------------------------------------------------------------
// Deterministic fake clock — fires due timers in chronological order, including
// timers scheduled by an earlier timer's callback (retry loop).
// ---------------------------------------------------------------------------

class FakeClock implements CommandClock {
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
// Mock host (send + ACK tap) and active-vehicle accessor.
// ---------------------------------------------------------------------------

type Sent = { name: string; fields: Record<string, unknown> };

class MockHost {
  readonly sent: Sent[] = [];
  private ackCb: ((msg: DecodedMessage) => void) | undefined;

  readonly sendMessage = (name: string, fields: Record<string, unknown>): void => {
    this.sent.push({ name, fields });
  };

  readonly onMessage = (
    _names: readonly string[],
    cb: (msg: DecodedMessage) => void,
  ): (() => void) => {
    this.ackCb = cb;
    return () => {
      this.ackCb = undefined;
    };
  };

  /** Deliver a COMMAND_ACK from `(sysid, compid)` for `command`. */
  emitAck(
    command: number,
    result: number,
    opts: { progress?: number; sysid?: number; compid?: number } = {},
  ): void {
    const fields: Record<string, FieldValue> = {
      command,
      result,
      progress: opts.progress ?? 0,
      result_param2: 0,
      target_system: 255,
      target_component: 0,
    };
    this.ackCb?.({
      sysid: opts.sysid ?? 1,
      compid: opts.compid ?? 1,
      seq: 0,
      msgId: 77,
      name: 'COMMAND_ACK',
      fields,
      crcOk: true,
      signed: false,
      rxTimeUs: 0,
      raw: new Uint8Array(),
    });
  }

  cmdLongs(command: number): Sent[] {
    return this.sent.filter((s) => s.name === 'COMMAND_LONG' && s.fields.command === command);
  }
}

const ACCEPTED = 0;
const DENIED = 2;
const UNSUPPORTED = 3;
const FAILED = 4;
const IN_PROGRESS = 5;

function vehicle(cls: VehicleClass, sysid = 1, compid = 1): ActiveVehicle {
  return { sysid, compid, vehicleClass: cls };
}

function setup(
  cls: VehicleClass = 'copter',
  extra: Partial<ConstructorParameters<typeof CommandClient>[0]> = {},
) {
  const host = new MockHost();
  const clock = new FakeClock();
  const client = createCommandClient({
    sendMessage: host.sendMessage,
    onMessage: host.onMessage,
    getActiveVehicle: () => vehicle(cls),
    clock,
    maxAttempts: 3,
    resendMs: 1000,
    progressTimeoutMs: 5000,
    ...extra,
  });
  return { host, clock, client };
}

// ---------------------------------------------------------------------------

describe('CommandClient — arm', () => {
  it('arm(true) encodes COMMAND_LONG command=400 param1=1 param2=0', async () => {
    const { host, client } = setup();
    const pr = client.arm(true);
    expect(host.cmdLongs(400)).toHaveLength(1);
    expect(host.sent[0]?.fields).toMatchObject({
      command: 400,
      param1: 1,
      param2: 0,
      target_system: 1,
      target_component: 1,
      confirmation: 0,
    });
    host.emitAck(400, ACCEPTED);
    await expect(pr).resolves.toBeUndefined();
  });

  it('arm(false, true) disarms with the force magic param2=21196', async () => {
    const { host, client } = setup();
    const pr = client.arm(false, true);
    expect(host.sent[0]?.fields).toMatchObject({ command: 400, param1: 0, param2: 21196 });
    host.emitAck(400, ACCEPTED);
    await pr;
  });
});

describe('CommandClient — send retry/ack correlation', () => {
  it('retries until the ACK arrives, then resolves ACCEPTED', async () => {
    const { host, clock, client } = setup();
    const pr = client.send(400, [1]);
    expect(host.cmdLongs(400)).toHaveLength(1);

    clock.advance(1000); // first resend (still no ACK)
    expect(host.cmdLongs(400)).toHaveLength(2);
    expect(host.sent[1]?.fields).toMatchObject({ confirmation: 1 });

    host.emitAck(400, ACCEPTED);
    await expect(pr).resolves.toEqual({ result: ACCEPTED });
    // No further resends after settling.
    clock.advance(5000);
    expect(host.cmdLongs(400)).toHaveLength(2);
  });

  it('times out and rejects after maxAttempts resends', async () => {
    const { host, clock, client } = setup();
    const pr = client.send(400, [1]);
    const caught = pr.catch((e: unknown) => e);

    clock.advance(1000); // attempt 2
    clock.advance(1000); // attempt 3
    expect(host.cmdLongs(400)).toHaveLength(3);
    clock.advance(1000); // exhausted -> timeout

    const err = await caught;
    expect(err).toBeInstanceOf(CommandError);
    expect((err as CommandError).reason).toBe('timeout');
    expect((err as CommandError).command).toBe(400);
  });

  it('rejects on DENIED with the MAV_RESULT carried on the error', async () => {
    const { host, client } = setup();
    const caught = client.send(400, [1]).catch((e: unknown) => e);
    host.emitAck(400, DENIED);
    const err = await caught;
    expect(err).toBeInstanceOf(CommandError);
    expect((err as CommandError).reason).toBe('rejected');
    expect((err as CommandError).result).toBe(DENIED);
  });

  it('rejects on FAILED', async () => {
    const { host, client } = setup();
    const caught = client.send(400, [1]).catch((e: unknown) => e);
    host.emitAck(400, FAILED);
    expect(((await caught) as CommandError).result).toBe(FAILED);
  });

  it('IN_PROGRESS keeps the command pending, then completes on ACCEPTED', async () => {
    const { host, clock, client } = setup();
    let settled = false;
    const pr = client.send(400, [1]).then((r) => {
      settled = true;
      return r;
    });

    host.emitAck(400, IN_PROGRESS, { progress: 42 });
    clock.advance(2000); // within the extended progress deadline
    expect(settled).toBe(false);
    // IN_PROGRESS must NOT trigger resends.
    expect(host.cmdLongs(400)).toHaveLength(1);

    host.emitAck(400, ACCEPTED);
    await expect(pr).resolves.toEqual({ result: ACCEPTED, progressPct: 42 });
  });

  it('rejects when an IN_PROGRESS command stalls past its deadline', async () => {
    const { host, clock, client } = setup();
    const caught = client.send(400, [1]).catch((e: unknown) => e);
    host.emitAck(400, IN_PROGRESS, { progress: 10 });
    clock.advance(5000); // progress deadline elapses with no terminal ACK
    expect(((await caught) as CommandError).reason).toBe('timeout');
  });

  it('ignores an ACK from a different vehicle', async () => {
    const { host, clock, client } = setup();
    const caught = client.send(400, [1]).catch((e: unknown) => e);
    host.emitAck(400, ACCEPTED, { sysid: 2 }); // wrong source
    clock.advance(1000);
    clock.advance(1000);
    clock.advance(1000);
    expect(((await caught) as CommandError).reason).toBe('timeout');
  });
});

describe('CommandClient — setMode per vehicle class', () => {
  async function modeNumber(cls: VehicleClass, mode: string): Promise<number> {
    const { host, client } = setup(cls);
    const pr = client.setMode(mode);
    const sent = host.sent[0];
    host.emitAck(176, ACCEPTED);
    await pr;
    return sent?.fields.param2 as number;
  }

  it("setMode('AUTO') encodes DO_SET_MODE (176) with the per-class custom_mode", async () => {
    expect(await modeNumber('copter', 'AUTO')).toBe(3);
    expect(await modeNumber('plane', 'AUTO')).toBe(10);
    expect(await modeNumber('rover', 'AUTO')).toBe(10);
  });

  it('encodes param1 = MAV_MODE_FLAG_CUSTOM_MODE_ENABLED (1)', async () => {
    const { host, client } = setup('copter');
    const pr = client.setMode('GUIDED');
    expect(host.sent[0]?.fields).toMatchObject({ command: 176, param1: 1, param2: 4 });
    host.emitAck(176, ACCEPTED);
    await pr;
  });

  it('GUIDED differs across classes (copter 4 vs plane 15)', async () => {
    expect(await modeNumber('copter', 'GUIDED')).toBe(4);
    expect(await modeNumber('plane', 'GUIDED')).toBe(15);
  });

  it('rejects an unknown mode name for the class', async () => {
    const { client } = setup('copter');
    await expect(client.setMode('NOPE')).rejects.toBeInstanceOf(CommandError);
  });

  it('falls back to SET_MODE (msg 11) when DO_SET_MODE is UNSUPPORTED', async () => {
    const { host, client } = setup('copter');
    const pr = client.setMode('RTL');
    host.emitAck(176, UNSUPPORTED);
    await pr;
    const setMode = host.sent.find((s) => s.name === 'SET_MODE');
    expect(setMode?.fields).toMatchObject({ target_system: 1, base_mode: 1, custom_mode: 6 });
  });
});

describe('CommandClient — guided / ROI / mission helpers', () => {
  it('guidedGoto encodes SET_POSITION_TARGET_GLOBAL_INT (86) with scaled lat/lon', async () => {
    const { host, client } = setup('copter');
    await client.guidedGoto(-35.363261, 149.16523, 30);
    const m = host.sent.find((s) => s.name === 'SET_POSITION_TARGET_GLOBAL_INT');
    expect(m).toBeDefined();
    expect(m?.fields).toMatchObject({
      coordinate_frame: 6,
      lat_int: Math.round(-35.363261 * 1e7),
      lon_int: Math.round(149.16523 * 1e7),
      alt: 30,
      target_system: 1,
      target_component: 1,
    });
    // Position-only mask: velocity/accel/yaw/yaw_rate ignored, position used.
    expect((m?.fields.type_mask as number) & 0b111).toBe(0);
  });

  it('setRoi encodes COMMAND_INT (195) with scaled int x/y', async () => {
    const { host, client } = setup('copter');
    const pr = client.setRoi(-35.1, 149.2, 5);
    const m = host.sent.find((s) => s.name === 'COMMAND_INT');
    expect(m?.fields).toMatchObject({
      command: 195,
      frame: 0,
      x: Math.round(-35.1 * 1e7),
      y: Math.round(149.2 * 1e7),
      z: 5,
    });
    host.emitAck(195, ACCEPTED);
    await pr;
  });

  it('clearRoi encodes COMMAND_LONG (197)', async () => {
    const { host, client } = setup('copter');
    const pr = client.clearRoi();
    expect(host.sent[0]?.fields).toMatchObject({ command: 197 });
    host.emitAck(197, ACCEPTED);
    await pr;
  });

  it('takeoff encodes NAV_TAKEOFF (22) with param7 = altitude', async () => {
    const { host, client } = setup('copter');
    const pr = client.takeoff(25);
    expect(host.sent[0]?.fields).toMatchObject({ command: 22, param7: 25 });
    host.emitAck(22, ACCEPTED);
    await pr;
  });

  it('land uses LAND mode for copters', async () => {
    const { host, client } = setup('copter');
    const pr = client.land();
    expect(host.sent[0]?.fields).toMatchObject({ command: 176, param2: 9 }); // copter LAND = 9
    host.emitAck(176, ACCEPTED);
    await pr;
  });

  it('land uses NAV_LAND (21) for non-copters', async () => {
    const { host, client } = setup('plane');
    const pr = client.land();
    expect(host.sent[0]?.fields).toMatchObject({ command: 21 });
    host.emitAck(21, ACCEPTED);
    await pr;
  });

  it('setCurrentWp encodes MISSION_SET_CURRENT (41)', async () => {
    const { host, client } = setup('copter');
    await client.setCurrentWp(3);
    expect(host.sent[0]).toEqual({
      name: 'MISSION_SET_CURRENT',
      fields: { target_system: 1, target_component: 1, seq: 3 },
    });
  });
});

describe('CommandClient — abort & no-vehicle', () => {
  it('AbortSignal cancels a pending command and stops resends', async () => {
    const { host, clock, client } = setup();
    const ac = new AbortController();
    const caught = client.send(400, [1], { signal: ac.signal }).catch((e: unknown) => e);
    expect(host.cmdLongs(400)).toHaveLength(1);
    ac.abort();
    const err = await caught;
    expect((err as CommandError).reason).toBe('aborted');
    clock.advance(5000);
    expect(host.cmdLongs(400)).toHaveLength(1); // no resend after abort
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const { client } = setup();
    const err = await client
      .send(400, [1], { signal: AbortSignal.abort() })
      .catch((e: unknown) => e);
    expect((err as CommandError).reason).toBe('aborted');
  });

  it('rejects with no-vehicle when no vehicle is active', async () => {
    const host = new MockHost();
    const client = createCommandClient({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getActiveVehicle: () => undefined,
    });
    const err = await client.send(400, [1]).catch((e: unknown) => e);
    expect((err as CommandError).reason).toBe('no-vehicle');
  });
});
