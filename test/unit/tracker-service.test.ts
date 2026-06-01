import { describe, it, expect, vi } from 'vitest';
import {
  MAV_TYPE_ANTENNA_TRACKER,
  TrackerService,
  createTrackerService,
} from '../../src/ui/screens/setup/tracker';
import type {
  DecodedMessage,
  FieldValue,
  Param,
  ParamClient,
  VehicleState,
} from '../../src/contracts';

// ---------------------------------------------------------------------------
// Mock host: records sent messages and replays decoded messages into the tap.
// ---------------------------------------------------------------------------

interface Sent {
  name: string;
  fields: Record<string, unknown>;
}

class MockHost {
  readonly sent: Sent[] = [];
  private cb: ((msg: DecodedMessage) => void) | undefined;
  private subscribed: readonly string[] = [];

  readonly sendMessage = (name: string, fields: Record<string, unknown>): void => {
    this.sent.push({ name, fields });
  };

  readonly onMessage = (
    names: readonly string[],
    cb: (msg: DecodedMessage) => void,
  ): (() => void) => {
    this.subscribed = names;
    this.cb = cb;
    return () => {
      this.cb = undefined;
    };
  };

  emit(name: string, fields: Record<string, FieldValue>, sysid = 71, compid = 1): void {
    if (this.cb === undefined) throw new Error('no tap subscribed');
    const msg: DecodedMessage = {
      sysid,
      compid,
      seq: 0,
      msgId: 0,
      name,
      fields,
      crcOk: true,
      signed: false,
      rxTimeUs: 0,
      raw: new Uint8Array(0),
    };
    this.cb(msg);
  }

  get names(): readonly string[] {
    return this.subscribed;
  }
}

// ---------------------------------------------------------------------------
// Mock ParamClient: an in-memory cache for get + a recording set.
// ---------------------------------------------------------------------------

class MockParamClient implements ParamClient {
  readonly setCalls: { name: string; value: number }[] = [];
  private readonly cache = new Map<string, Param>();

  seed(name: string, value: number, type = 9): void {
    this.cache.set(name, { name, value, type });
  }

  fetchAll = vi.fn<ParamClient['fetchAll']>(async () => [...this.cache.values()]);

  get(name: string): Param | undefined {
    return this.cache.get(name);
  }

  set = vi.fn<ParamClient['set']>(async (name, value) => {
    this.setCalls.push({ name, value });
    this.cache.set(name, { name, value, type: 9 });
  });

  onChange = vi.fn<ParamClient['onChange']>(() => () => undefined);
}

function makeVehicle(position?: VehicleState['position']): VehicleState {
  return {
    sysid: 1,
    compid: 1,
    mavType: 2,
    autopilot: 3,
    vehicleClass: 'copter',
    armed: false,
    mode: 'STABILIZE',
    attitude: { rollRad: 0, pitchRad: 0, yawRad: Math.PI / 2 },
    ...(position !== undefined ? { position } : {}),
    link: { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false },
    lastHeartbeatMs: 0,
  };
}

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('TrackerService detection', () => {
  it('latches a tracker target only from a MAV_TYPE_ANTENNA_TRACKER heartbeat', () => {
    const host = new MockHost();
    const service = createTrackerService({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getActiveVehicle: () => undefined,
      now: () => 0,
    });

    // A copter heartbeat must NOT latch a tracker.
    host.emit('HEARTBEAT', { type: 2 }, 1, 1);
    expect(service.getState().target).toBeUndefined();
    expect(service.getState().connected).toBe(false);

    // An antenna-tracker heartbeat latches the (sysid, compid) and connects.
    host.emit('HEARTBEAT', { type: MAV_TYPE_ANTENNA_TRACKER }, 71, 1);
    const state = service.getState();
    expect(state.target).toEqual({ sysid: 71, compid: 1 });
    expect(state.connected).toBe(true);
    expect(host.names).toContain('HEARTBEAT');

    service.dispose();
  });

  it('derives disconnection from heartbeat staleness', () => {
    let now = 0;
    const host = new MockHost();
    const service = new TrackerService({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getActiveVehicle: () => undefined,
      now: () => now,
      connectionTimeoutMs: 3000,
    });
    host.emit('HEARTBEAT', { type: MAV_TYPE_ANTENNA_TRACKER }, 71, 1);
    expect(service.getState().connected).toBe(true);
    now = 5000;
    expect(service.getState().connected).toBe(false);
    service.dispose();
  });

  it('surfaces pointing only from the latched tracker target', () => {
    const host = new MockHost();
    const service = createTrackerService({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getActiveVehicle: () => undefined,
      now: () => 0,
    });
    host.emit('HEARTBEAT', { type: MAV_TYPE_ANTENNA_TRACKER }, 71, 1);

    // ATTITUDE from a different system is ignored.
    host.emit('ATTITUDE', { yaw: 0, pitch: 0 }, 1, 1);
    expect(service.getState().attitude).toBeUndefined();

    // ATTITUDE from the tracker is surfaced (yaw → azimuth, pitch → elevation).
    host.emit('ATTITUDE', { yaw: Math.PI / 2, pitch: Math.PI / 6 }, 71, 1);
    const att = service.getState().attitude;
    expect(att?.azimuthDeg).toBeCloseTo(90, 4);
    expect(att?.elevationDeg).toBeCloseTo(30, 4);

    service.dispose();
  });

  it('computes a pointing solution from tracker position toward the vehicle', () => {
    const host = new MockHost();
    const vehicle = makeVehicle({ lat: 47.001, lon: 8, altRelM: 100, altAmslM: 600 });
    const service = createTrackerService({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getActiveVehicle: () => vehicle,
      now: () => 0,
    });
    host.emit('HEARTBEAT', { type: MAV_TYPE_ANTENNA_TRACKER }, 71, 1);
    host.emit('GLOBAL_POSITION_INT', { lat: 47e7, lon: 8e7, alt: 500_000 }, 71, 1);

    const sol = service.getState().solution;
    expect(sol).toBeDefined();
    expect(sol?.azimuthDeg).toBeCloseTo(0, 1); // vehicle due north of tracker
    expect(sol?.distanceM).toBeGreaterThan(0);
    service.dispose();
  });
});

describe('TrackerService position feed', () => {
  it('rate-limits the GLOBAL_POSITION_INT sent to the tracker', () => {
    let now = 0;
    const host = new MockHost();
    const vehicle = makeVehicle({ lat: 47.5, lon: 8.25, altRelM: 120, altAmslM: 620 });
    const service = createTrackerService({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getActiveVehicle: () => vehicle,
      now: () => now,
      feedIntervalMs: 1000,
    });

    // No tracker yet → nothing to feed.
    expect(service.feedVehiclePosition()).toBe(false);
    expect(host.sent).toHaveLength(0);

    host.emit('HEARTBEAT', { type: MAV_TYPE_ANTENNA_TRACKER }, 71, 1);

    // First feed sends the vehicle position.
    expect(service.feedVehiclePosition()).toBe(true);
    expect(host.sent).toHaveLength(1);
    const sent = host.sent[0];
    expect(sent?.name).toBe('GLOBAL_POSITION_INT');
    expect(sent?.fields.lat).toBe(Math.round(47.5 * 1e7));
    expect(sent?.fields.lon).toBe(Math.round(8.25 * 1e7));
    expect(sent?.fields.alt).toBe(Math.round(620 * 1000));
    expect(sent?.fields.relative_alt).toBe(Math.round(120 * 1000));

    // A second immediate call is suppressed by the rate limit.
    expect(service.feedVehiclePosition()).toBe(false);
    expect(host.sent).toHaveLength(1);

    // After the interval elapses, the next call sends again.
    now = 1000;
    expect(service.feedVehiclePosition()).toBe(true);
    expect(host.sent).toHaveLength(2);

    service.dispose();
  });

  it('skips the feed when the active vehicle has no position', () => {
    const host = new MockHost();
    const service = createTrackerService({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getActiveVehicle: () => makeVehicle(undefined),
      now: () => 0,
    });
    host.emit('HEARTBEAT', { type: MAV_TYPE_ANTENNA_TRACKER }, 71, 1);
    expect(service.feedVehiclePosition()).toBe(false);
    expect(host.sent).toHaveLength(0);
    service.dispose();
  });
});

describe('TrackerService config', () => {
  it('reads config from the ParamClient cache with defaults', () => {
    const host = new MockHost();
    const params = new MockParamClient();
    params.seed('YAW_RANGE', 270);
    params.seed('SERVO_YAW_TYPE', 2);
    const service = createTrackerService({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getActiveVehicle: () => undefined,
      params,
    });

    expect(service.canConfigure).toBe(true);
    const config = service.getConfig();
    expect(config.YAW_RANGE).toBe(270);
    expect(config.SERVO_YAW_TYPE).toBe(2);
    // Unseeded params fall back to the field default.
    expect(config.PITCH_MIN).toBe(-90);
    expect(config.PITCH_MAX).toBe(90);
    service.dispose();
  });

  it('writes config through the ParamClient', async () => {
    const host = new MockHost();
    const params = new MockParamClient();
    const service = createTrackerService({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getActiveVehicle: () => undefined,
      params,
    });

    await service.setConfig('PITCH_MAX', 60);
    await flush();
    expect(params.set).toHaveBeenCalledWith('PITCH_MAX', 60);
    expect(params.setCalls).toEqual([{ name: 'PITCH_MAX', value: 60 }]);
    expect(service.getConfig().PITCH_MAX).toBe(60);
    service.dispose();
  });

  it('reports it cannot configure without a ParamClient', () => {
    const host = new MockHost();
    const service = createTrackerService({
      sendMessage: host.sendMessage,
      onMessage: host.onMessage,
      getActiveVehicle: () => undefined,
    });
    expect(service.canConfigure).toBe(false);
    expect(() => service.getConfig()).toThrow();
    service.dispose();
  });
});
