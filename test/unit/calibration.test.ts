import { describe, expect, it, vi } from 'vitest';
import type { CommandClient, DecodedMessage, FieldValue } from '../../src/contracts';
import {
  ACCEL_FACES,
  CMD_ACCELCAL_VEHICLE_POS,
  CMD_DO_CANCEL_MAG_CAL,
  CMD_DO_START_MAG_CAL,
  CMD_PREFLIGHT_CALIBRATION,
  CalibrationClient,
  CalibrationError,
  MAG_CAL_STATUS,
  MSG_MAG_CAL_PROGRESS,
  MSG_MAG_CAL_REPORT,
  MSG_RC_CHANNELS,
  MSG_STATUSTEXT,
  type CalibrationMessageTap,
  type CalibrationTarget,
} from '../../src/mavlink/microservices/calibration';

type SentCommand = { cmd: number; params: number[]; signal?: AbortSignal };

class MockCommand implements Pick<CommandClient, 'send'> {
  readonly sent: SentCommand[] = [];

  readonly send = vi.fn<CommandClient['send']>(
    (cmd: number, params: number[], opts?: { signal?: AbortSignal }) => {
      const sent: SentCommand = { cmd, params: [...params] };
      if (opts?.signal !== undefined) sent.signal = opts.signal;
      this.sent.push(sent);
      if (opts?.signal?.aborted === true) {
        return Promise.reject(new Error('aborted'));
      }
      return Promise.resolve({ result: 0 });
    },
  );
}

class MockMessages {
  private readonly subscribers: { names: readonly string[]; cb: (msg: DecodedMessage) => void }[] =
    [];

  readonly onMessage: CalibrationMessageTap = (names, cb) => {
    const sub = { names, cb };
    this.subscribers.push(sub);
    return () => {
      const i = this.subscribers.indexOf(sub);
      if (i >= 0) this.subscribers.splice(i, 1);
    };
  };

  emit(name: string, fields: Record<string, FieldValue>, sysid = 1, compid = 1): void {
    for (const sub of [...this.subscribers]) {
      if (!sub.names.includes(name)) continue;
      sub.cb({
        sysid,
        compid,
        seq: 0,
        msgId: messageId(name),
        name,
        fields,
        crcOk: true,
        signed: false,
        rxTimeUs: 0,
        raw: new Uint8Array(),
      });
    }
  }
}

function messageId(name: string): number {
  switch (name) {
    case 'MAG_CAL_PROGRESS':
      return MSG_MAG_CAL_PROGRESS;
    case 'MAG_CAL_REPORT':
      return MSG_MAG_CAL_REPORT;
    case 'STATUSTEXT':
      return MSG_STATUSTEXT;
    case 'RC_CHANNELS':
      return MSG_RC_CHANNELS;
    default:
      return 0;
  }
}

function setup(): { command: MockCommand; messages: MockMessages; client: CalibrationClient } {
  const command = new MockCommand();
  const messages = new MockMessages();
  const target: CalibrationTarget = { sysid: 1, compid: 1 };
  const client = new CalibrationClient({
    command,
    onMessage: messages.onMessage,
    getTarget: () => target,
    compassTimeoutMs: 10_000,
  });
  return { command, messages, client };
}

function defer(): { promise: Promise<void>; resolve: () => void } {
  let resolveFn: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });
  return { promise, resolve: resolveFn };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (condition()) return;
    await flush();
  }
  throw new Error('condition not met');
}

describe('CalibrationClient — gyro and level', () => {
  it('gyro sends PREFLIGHT_CALIBRATION with p1=1 and resolves on command ACK', async () => {
    const { command, client } = setup();

    await client.gyro();

    expect(command.sent).toHaveLength(1);
    expect(command.sent[0]).toMatchObject({
      cmd: CMD_PREFLIGHT_CALIBRATION,
      params: [1, 0, 0, 0, 0, 0, 0],
    });
  });

  it('level sends PREFLIGHT_CALIBRATION with p5=2 and resolves on command ACK', async () => {
    const { command, client } = setup();

    await client.level();

    expect(command.sent).toHaveLength(1);
    expect(command.sent[0]).toMatchObject({
      cmd: CMD_PREFLIGHT_CALIBRATION,
      params: [0, 0, 0, 0, 2, 0, 0],
    });
  });
});

describe('CalibrationClient — accel6Point', () => {
  it('walks the six accel positions in order, gated by step(face)', async () => {
    const { command, client } = setup();
    const gates = ACCEL_FACES.map(() => defer());
    const requestedFaces: string[] = [];
    const op = client.accel6Point((face) => {
      requestedFaces.push(face);
      const gate = gates[requestedFaces.length - 1];
      if (gate === undefined) throw new Error('unexpected face');
      return gate.promise;
    });

    await flush();
    expect(requestedFaces).toEqual(['LEVEL']);
    expect(command.sent).toHaveLength(1);
    expect(command.sent[0]).toMatchObject({
      cmd: CMD_PREFLIGHT_CALIBRATION,
      params: [0, 0, 0, 0, 1, 0, 0],
    });

    for (let i = 0; i < gates.length; i++) {
      await waitFor(() => requestedFaces.length === i + 1);
      const gate = gates[i];
      const face = ACCEL_FACES[i];
      if (gate === undefined || face === undefined) throw new Error('missing gate/face');
      gate.resolve();
      await waitFor(() => command.sent.length >= i + 2);
      expect(command.sent[i + 1]).toMatchObject({
        cmd: CMD_ACCELCAL_VEHICLE_POS,
        params: [face.value, 0, 0, 0, 0, 0, 0],
      });
    }

    await expect(op).resolves.toBeUndefined();
    expect(requestedFaces).toEqual(['LEVEL', 'LEFT', 'RIGHT', 'NOSEDOWN', 'NOSEUP', 'BACK']);
  });

  it('rejects when accel STATUSTEXT reports failure', async () => {
    const { messages, client } = setup();
    const never = new Promise<void>(() => undefined);
    const op = client.accel6Point(() => never).catch((err: unknown) => err);

    await flush();
    messages.emit('STATUSTEXT', { text: 'Accel calibration failed' });

    const err = await op;
    expect(err).toBeInstanceOf(CalibrationError);
    expect((err as CalibrationError).reason).toBe('failed');
  });
});

describe('CalibrationClient — compass', () => {
  it('starts MAG_CAL, reports progress, and resolves offsets from MAG_CAL_REPORT', async () => {
    const { command, messages, client } = setup();
    const onProgress = vi.fn<(pct: number, fitness?: number) => void>();
    const op = client.compass(onProgress);

    await flush();
    expect(command.sent[0]).toMatchObject({
      cmd: CMD_DO_START_MAG_CAL,
      params: [0, 0, 1, 0, 0, 0, 0],
    });

    messages.emit('MAG_CAL_PROGRESS', {
      completion_pct: 37,
      cal_status: MAG_CAL_STATUS.RUNNING_STEP_ONE,
    });
    messages.emit('MAG_CAL_REPORT', {
      cal_status: MAG_CAL_STATUS.SUCCESS,
      fitness: 8.5,
      ofs_x: 11,
      ofs_y: -22,
      ofs_z: 33,
    });

    await expect(op).resolves.toEqual({ offsets: [11, -22, 33] });
    expect(onProgress).toHaveBeenCalledWith(37);
  });

  it('aborts compass calibration and sends DO_CANCEL_MAG_CAL', async () => {
    const { command, client } = setup();
    const ac = new AbortController();
    const op = client.compass(() => undefined, ac.signal);

    await flush();
    ac.abort();

    await expect(op).rejects.toMatchObject({ reason: 'aborted' });
    expect(command.sent.some((s) => s.cmd === CMD_DO_CANCEL_MAG_CAL)).toBe(true);
  });
});

describe('CalibrationClient — radio', () => {
  it('forwards RC_CHANNELS values until the signal aborts, then resolves', async () => {
    const { messages, client } = setup();
    const ac = new AbortController();
    const received: number[][] = [];
    const op = client.radio((channels) => received.push(channels), ac.signal);

    messages.emit('RC_CHANNELS', {
      chancount: 4,
      chan1_raw: 1000,
      chan2_raw: 1500,
      chan3_raw: 1900,
      chan4_raw: 1100,
    });
    expect(received).toEqual([[1000, 1500, 1900, 1100]]);

    ac.abort();
    await expect(op).resolves.toBeUndefined();
    messages.emit('RC_CHANNELS', {
      chancount: 1,
      chan1_raw: 1200,
    });
    expect(received).toEqual([[1000, 1500, 1900, 1100]]);
  });
});
