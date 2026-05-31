import { describe, it, expect, vi } from 'vitest';
import type { ConnState, LinkStats, VehicleState } from '../../src/contracts';
import {
  ConnectionManager,
  createConnectionManager,
  type HostTelemetry,
  type MavlinkHostLike,
} from '../../src/transport/manager';

// ---------------------------------------------------------------------------
// Mock host (no real Worker is spun — see plan/03 §3.7; SITL path is M1 gate)
// ---------------------------------------------------------------------------

function zeroLink(): LinkStats {
  return { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false };
}

function makeVehicle(sysid: number, overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    sysid,
    compid: 1,
    mavType: 2,
    autopilot: 3,
    vehicleClass: 'copter',
    armed: false,
    mode: 'STABILIZE',
    attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
    link: zeroLink(),
    lastHeartbeatMs: 0,
    ...overrides,
  };
}

class MockHost implements MavlinkHostLike {
  readonly connectCalls: Array<{ factoryId: string; config: unknown }> = [];
  disconnectCalls = 0;
  disposeCalls = 0;
  readonly sentMessages: Array<{ name: string; fields: Record<string, unknown> }> = [];
  connectImpl: () => Promise<void> = () => Promise.resolve();
  private readonly stateCbs = new Set<(s: ConnState) => void>();
  private readonly teleCbs = new Set<(t: HostTelemetry) => void>();
  private _stats: LinkStats = zeroLink();

  connect(factoryId: string, config: unknown): Promise<void> {
    this.connectCalls.push({ factoryId, config });
    return this.connectImpl();
  }
  disconnect(): Promise<void> {
    this.disconnectCalls += 1;
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
    return this._stats;
  }
  dispose(): Promise<void> {
    this.disposeCalls += 1;
    return Promise.resolve();
  }

  // test helpers
  emitState(s: ConnState): void {
    for (const cb of this.stateCbs) cb(s);
  }
  emitTelemetry(t: HostTelemetry): void {
    for (const cb of this.teleCbs) cb(t);
  }
  setStats(s: LinkStats): void {
    this._stats = s;
  }
  stateListenerCount(): number {
    return this.stateCbs.size;
  }
}

// ---------------------------------------------------------------------------

describe('ConnectionManager — connect/disconnect delegation', () => {
  it('delegates connect with the factory id + config and records the factory', async () => {
    const host = new MockHost();
    const mgr = new ConnectionManager({ host });

    await mgr.connect('websocket', { url: 'ws://localhost:5760' });

    expect(host.connectCalls).toEqual([
      { factoryId: 'websocket', config: { url: 'ws://localhost:5760' } },
    ]);
    expect(mgr.factoryId()).toBe('websocket');
  });

  it('delegates disconnect and clears the active factory', async () => {
    const host = new MockHost();
    const mgr = new ConnectionManager({ host });
    await mgr.connect('serial', { baudRate: 115200 });

    await mgr.disconnect();

    expect(host.disconnectCalls).toBe(1);
    expect(mgr.factoryId()).toBeUndefined();
  });

  it('surfaces an error state and re-throws when the host rejects connect', async () => {
    const host = new MockHost();
    host.connectImpl = () => Promise.reject(new Error('port denied'));
    const mgr = new ConnectionManager({ host });
    const states: ConnState[] = [];
    mgr.onState((s) => states.push(s));

    await expect(mgr.connect('serial', {})).rejects.toThrow('port denied');
    expect(states.at(-1)).toEqual({ kind: 'error', message: 'port denied' });
  });
});

describe('ConnectionManager — state mapping', () => {
  it('forwards host state transitions to listeners and state()', () => {
    const host = new MockHost();
    const mgr = new ConnectionManager({ host });
    const states: ConnState[] = [];
    mgr.onState((s) => states.push(s));

    host.emitState({ kind: 'opening' });
    host.emitState({ kind: 'open' });

    expect(states).toEqual([{ kind: 'opening' }, { kind: 'open' }]);
    expect(mgr.state()).toEqual({ kind: 'open' });
  });

  it('clears detected vehicles when the link closes', () => {
    const host = new MockHost();
    const mgr = new ConnectionManager({ host });
    host.emitTelemetry({ vehicles: [makeVehicle(1)], activeSysid: 1 });
    expect(mgr.vehicles()).toHaveLength(1);

    host.emitState({ kind: 'closed' });

    expect(mgr.vehicles()).toHaveLength(0);
    expect(mgr.activeSysid()).toBeUndefined();
  });
});

describe('ConnectionManager — vehicle detection + active selection', () => {
  it('exposes detected vehicles and the snapshot active sysid', () => {
    const host = new MockHost();
    const mgr = new ConnectionManager({ host });
    const events: number[] = [];
    mgr.onTelemetry((t) => events.push(t.vehicles.length));

    host.emitTelemetry({ vehicles: [makeVehicle(1), makeVehicle(2)], activeSysid: 2 });

    expect(mgr.vehicles().map((v) => v.sysid)).toEqual([1, 2]);
    expect(mgr.activeSysid()).toBe(2);
    expect(events).toEqual([2]);
  });

  it('honors an explicit active-vehicle selection and falls back when it vanishes', () => {
    const host = new MockHost();
    const mgr = new ConnectionManager({ host });
    host.emitTelemetry({ vehicles: [makeVehicle(1), makeVehicle(2)], activeSysid: 2 });

    mgr.setActiveVehicle(1);
    expect(mgr.activeSysid()).toBe(1);
    expect(mgr.activeVehicle()?.sysid).toBe(1);

    // Vehicle 1 disappears → fall back to the snapshot's most-recent sysid.
    host.emitTelemetry({ vehicles: [makeVehicle(2)], activeSysid: 2 });
    expect(mgr.activeSysid()).toBe(2);
  });
});

describe('ConnectionManager — diagnostics + lifecycle', () => {
  it('returns the host merged link stats', () => {
    const host = new MockHost();
    const stats: LinkStats = {
      bytesIn: 100,
      bytesOut: 20,
      packetsIn: 5,
      lossPct: 1.5,
      rateHz: 12.5,
      rssi: 180,
      signed: true,
    };
    host.setStats(stats);
    const mgr = new ConnectionManager({ host });
    expect(mgr.stats()).toEqual(stats);
  });

  it('passes messages through to the host', async () => {
    const host = new MockHost();
    const mgr = createConnectionManager({ host });
    await mgr.sendMessage('HEARTBEAT', { type: 6 });
    expect(host.sentMessages).toEqual([{ name: 'HEARTBEAT', fields: { type: 6 } }]);
  });

  it('disposes the host and releases subscriptions', async () => {
    const host = new MockHost();
    const mgr = new ConnectionManager({ host });
    expect(host.stateListenerCount()).toBe(1);

    await mgr.dispose();

    expect(host.disposeCalls).toBe(1);
    expect(host.stateListenerCount()).toBe(0);
    // Further connect attempts are rejected after disposal.
    await expect(mgr.connect('serial', {})).rejects.toThrow('disposed');
  });

  it('is a no-op to dispose twice', async () => {
    const host = new MockHost();
    const mgr = new ConnectionManager({ host });
    await mgr.dispose();
    await mgr.dispose();
    expect(host.disposeCalls).toBe(1);
  });
});

describe('ConnectionManager — onTelemetry registration', () => {
  it('stops notifying after unsubscribe', () => {
    const host = new MockHost();
    const mgr = new ConnectionManager({ host });
    const cb = vi.fn();
    const off = mgr.onTelemetry(cb);
    host.emitTelemetry({ vehicles: [makeVehicle(1)], activeSysid: 1 });
    off();
    host.emitTelemetry({ vehicles: [makeVehicle(1), makeVehicle(2)], activeSysid: 2 });
    expect(cb).toHaveBeenCalledTimes(1);
  });
});
