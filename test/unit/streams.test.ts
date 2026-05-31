import { describe, it, expect, vi } from 'vitest';
import {
  createStreamRateService,
  StreamRateService,
} from '../../src/mavlink/microservices/streams';
import { commonDialect } from '../../src/mavlink/dialects';
import type { ConnState, LinkStats } from '../../src/contracts';
import {
  ConnectionManager,
  type HostTelemetry,
  type MavlinkHostLike,
} from '../../src/transport/manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Sent = { name: string; fields: Record<string, unknown> };

function recorder(): { send: (n: string, f: Record<string, unknown>) => void; sent: Sent[] } {
  const sent: Sent[] = [];
  return { send: (name, fields) => void sent.push({ name, fields }), sent };
}

/** Resolve a message id by name from the bundled common dialect. */
function msgId(name: string): number {
  const meta = Object.values(commonDialect.messages).find((m) => m.name === name);
  if (meta === undefined) throw new Error(`missing message ${name}`);
  return meta.id;
}

/** Resolve a MAV_DATA_STREAM enum value by name. */
function streamId(name: string): number {
  const entry = commonDialect.enums.MAV_DATA_STREAM?.find((e) => e.name === name);
  if (entry === undefined) throw new Error(`missing stream ${name}`);
  return entry.value;
}

// ---------------------------------------------------------------------------

describe('StreamRateService — SET_MESSAGE_INTERVAL', () => {
  it('setMessageRate(33, 4) emits COMMAND_LONG command=511 param1=33 param2=250000', async () => {
    const { send, sent } = recorder();
    const svc = createStreamRateService({ send });

    await svc.setMessageRate(33, 4);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.name).toBe('COMMAND_LONG');
    expect(sent[0]?.fields).toMatchObject({
      command: 511,
      param1: 33,
      param2: 250000,
      param3: 0,
      param4: 0,
      param5: 0,
      param6: 0,
      param7: 0,
      target_system: 1,
      target_component: 1,
      confirmation: 0,
    });
  });

  it('hz===0 requests the firmware default interval (param2=0)', async () => {
    const { send, sent } = recorder();
    await createStreamRateService({ send }).setMessageRate(30, 0);
    expect(sent[0]?.fields).toMatchObject({ command: 511, param1: 30, param2: 0 });
  });

  it('disableMessage emits param2=-1', async () => {
    const { send, sent } = recorder();
    await createStreamRateService({ send }).disableMessage(74);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.fields).toMatchObject({ command: 511, param1: 74, param2: -1 });
  });

  it('honors a custom target system/component', async () => {
    const { send, sent } = recorder();
    await createStreamRateService({ send, targetSystem: 7, targetComponent: 2 }).setMessageRate(
      1,
      2,
    );
    expect(sent[0]?.fields).toMatchObject({ target_system: 7, target_component: 2 });
  });

  it('awaits an async send fn', async () => {
    const calls: Sent[] = [];
    const svc = new StreamRateService({
      send: (name, fields) =>
        new Promise<void>((resolve) => {
          calls.push({ name, fields });
          resolve();
        }),
    });
    await svc.setMessageRate(42, 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.fields).toMatchObject({ command: 511, param1: 42, param2: 1_000_000 });
  });
});

describe('StreamRateService — requestDefaultSet', () => {
  it('issues the expected modest-rate live-ops set via SET_MESSAGE_INTERVAL', async () => {
    const { send, sent } = recorder();
    await createStreamRateService({ send }).requestDefaultSet();

    const expectedIds = [
      'SYS_STATUS',
      'ATTITUDE',
      'GLOBAL_POSITION_INT',
      'GPS_RAW_INT',
      'VFR_HUD',
      'RC_CHANNELS',
      'BATTERY_STATUS',
      'MISSION_CURRENT',
    ].map(msgId);

    expect(sent.map((s) => s.name)).toEqual(expectedIds.map(() => 'COMMAND_LONG'));
    // Every default request is SET_MESSAGE_INTERVAL at 4 Hz (250000 µs).
    for (const s of sent) {
      expect(s.fields.command).toBe(511);
      expect(s.fields.param2).toBe(250000);
    }
    expect(sent.map((s) => s.fields.param1)).toEqual(expectedIds);
    // HEARTBEAT is vehicle-driven and must not be requested.
    expect(sent.map((s) => s.fields.param1)).not.toContain(msgId('HEARTBEAT'));
  });
});

describe('StreamRateService — REQUEST_DATA_STREAM fallback', () => {
  it('requestDataStream emits REQUEST_DATA_STREAM with rate + start_stop', async () => {
    const { send, sent } = recorder();
    const svc = createStreamRateService({ send });

    await svc.requestDataStream(streamId('MAV_DATA_STREAM_POSITION'), 5);
    await svc.requestDataStream(streamId('MAV_DATA_STREAM_EXTRA1'), 10, false);

    expect(sent[0]).toEqual({
      name: 'REQUEST_DATA_STREAM',
      fields: {
        target_system: 1,
        target_component: 1,
        req_stream_id: streamId('MAV_DATA_STREAM_POSITION'),
        req_message_rate: 5,
        start_stop: 1,
      },
    });
    expect(sent[1]?.fields).toMatchObject({ start_stop: 0, req_message_rate: 10 });
  });

  it('requestDefaultSet uses the data-stream groups when useLegacyDataStream is set', async () => {
    const { send, sent } = recorder();
    await createStreamRateService({ send, useLegacyDataStream: true }).requestDefaultSet();

    expect(sent.map((s) => s.name)).toEqual(sent.map(() => 'REQUEST_DATA_STREAM'));
    expect(sent.map((s) => s.fields.req_stream_id)).toEqual(
      [
        'MAV_DATA_STREAM_EXTENDED_STATUS',
        'MAV_DATA_STREAM_POSITION',
        'MAV_DATA_STREAM_EXTRA1',
        'MAV_DATA_STREAM_EXTRA2',
        'MAV_DATA_STREAM_RC_CHANNELS',
      ].map(streamId),
    );
    for (const s of sent) expect(s.fields).toMatchObject({ req_message_rate: 4, start_stop: 1 });
  });
});

// ---------------------------------------------------------------------------
// ConnectionManager integration (mock host; mirrors the manager test pattern)
// ---------------------------------------------------------------------------

function zeroLink(): LinkStats {
  return { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false };
}

class MockHost implements MavlinkHostLike {
  readonly sentMessages: Sent[] = [];
  private readonly stateCbs = new Set<(s: ConnState) => void>();
  private readonly teleCbs = new Set<(t: HostTelemetry) => void>();

  connect(): Promise<void> {
    return Promise.resolve();
  }
  disconnect(): Promise<void> {
    this.emitState({ kind: 'closed' });
    return Promise.resolve();
  }
  sendMessage(name: string, fields: Record<string, unknown>): Promise<void> {
    this.sentMessages.push({ name, fields });
    return Promise.resolve();
  }
  onState(cb: (s: ConnState) => void): () => void {
    this.stateCbs.add(cb);
    return () => this.stateCbs.delete(cb);
  }
  onTelemetry(cb: (t: HostTelemetry) => void): () => void {
    this.teleCbs.add(cb);
    return () => this.teleCbs.delete(cb);
  }
  stats(): LinkStats {
    return zeroLink();
  }
  dispose(): Promise<void> {
    return Promise.resolve();
  }
  emitState(s: ConnState): void {
    for (const cb of this.stateCbs) cb(s);
  }
}

function commandLongs(host: MockHost): Sent[] {
  return host.sentMessages.filter((m) => m.name === 'COMMAND_LONG' && m.fields.command === 511);
}

describe('ConnectionManager — stream-rate integration (T1.11)', () => {
  it('requests the default set exactly once on the transition to open', () => {
    const host = new MockHost();
    const mgr = new ConnectionManager({ host });

    host.emitState({ kind: 'opening' });
    expect(commandLongs(host)).toHaveLength(0);

    host.emitState({ kind: 'open' });
    expect(commandLongs(host)).toHaveLength(8);

    // A second `open` without an intervening close must not re-request.
    host.emitState({ kind: 'open' });
    expect(commandLongs(host)).toHaveLength(8);

    void mgr.dispose();
  });

  it('does not request the default set on close, and re-requests on the next open', () => {
    const host = new MockHost();
    new ConnectionManager({ host });

    host.emitState({ kind: 'open' });
    expect(commandLongs(host)).toHaveLength(8);

    host.emitState({ kind: 'closed' });
    expect(commandLongs(host)).toHaveLength(8); // closing issues no requests

    host.emitState({ kind: 'open' });
    expect(commandLongs(host)).toHaveLength(16); // fresh session re-requests
  });

  it('binds the requests to the host send path', () => {
    const host = new MockHost();
    const spy = vi.spyOn(host, 'sendMessage');
    new ConnectionManager({ host });
    host.emitState({ kind: 'open' });
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls.every(([name]) => name === 'COMMAND_LONG')).toBe(true);
  });
});
