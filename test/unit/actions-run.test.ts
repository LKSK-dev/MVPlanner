/**
 * Unit tests for the confirm→command→audit flow (task T2.7; spec plan/04 §4.2,
 * plan/08 §8.3). Drives {@link runAction} with a mock CommandClient + a mock
 * confirm (resolving true/false) + a real audit log, asserting: confirm=false
 * aborts (no command, cancelled audit); confirm=true invokes the right client
 * call and records start+result; the armed-aware confirm flag; state gating
 * (blocked); non-destructive (no-confirm) audited actions; and error capture.
 */
import { describe, it, expect } from 'vitest';
import type { CommandClient, ConfirmOptions } from '../../src/contracts';
import { createAuditLog } from '../../src/core/audit';
import {
  gateContextFor,
  runAction,
  type ActionVehicle,
  type ActionsDeps,
} from '../../src/ui/screens/flight/actions';

interface Call {
  method: string;
  args: readonly unknown[];
}

function mockCommand(): { client: CommandClient; calls: Call[]; fail: { on: boolean } } {
  const calls: Call[] = [];
  const fail = { on: false };
  const rec =
    (method: string) =>
    (...args: unknown[]): Promise<void> => {
      calls.push({ method, args });
      return fail.on ? Promise.reject(new Error('boom')) : Promise.resolve();
    };
  const client: CommandClient = {
    send: (cmd, params, opts) => {
      calls.push({
        method: 'send',
        args: opts === undefined ? [cmd, params] : [cmd, params, opts],
      });
      return fail.on ? Promise.reject(new Error('boom')) : Promise.resolve({ result: 0 });
    },
    arm: rec('arm'),
    setMode: rec('setMode'),
    takeoff: rec('takeoff'),
    land: rec('land'),
    rtl: rec('rtl'),
    guidedGoto: rec('guidedGoto'),
    setRoi: rec('setRoi'),
    clearRoi: rec('clearRoi'),
    setCurrentWp: rec('setCurrentWp'),
  };
  return { client, calls, fail };
}

function veh(over: Partial<ActionVehicle> = {}): ActionVehicle {
  return { vehicleClass: 'copter', armed: false, ...over };
}

function makeDeps(
  over: Partial<ActionsDeps> & { confirmValue?: boolean; confirmCapture?: ConfirmOptions[] } = {},
): {
  deps: ActionsDeps;
  command: ReturnType<typeof mockCommand>;
  audit: ReturnType<typeof createAuditLog>;
} {
  const command = mockCommand();
  const audit = createAuditLog({ clock: () => 1000 });
  const { confirmValue = true, confirmCapture, getActiveVehicle, ...rest } = over;
  const deps: ActionsDeps = {
    command: command.client,
    confirm: (opts) => {
      confirmCapture?.push(opts);
      return Promise.resolve(confirmValue);
    },
    audit,
    getActiveVehicle: getActiveVehicle ?? (() => veh({ armed: true })),
    ...rest,
  };
  return { deps, command, audit };
}

describe('runAction — confirm gate', () => {
  it('confirm=false aborts: no command sent, cancelled audit entry recorded', async () => {
    const { deps, command, audit } = makeDeps({ confirmValue: false });
    const out = await runAction(deps, 'disarm');
    expect(out.status).toBe('cancelled');
    expect(command.calls).toHaveLength(0);
    const list = audit.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe('cancelled');
    expect(list[0]?.result).toBe('cancelled');
  });

  it('confirm=true invokes the right CommandClient call and records start+result', async () => {
    const { deps, command, audit } = makeDeps({ confirmValue: true });
    const out = await runAction(deps, 'disarm');
    expect(out.status).toBe('ok');
    expect(command.calls).toEqual([{ method: 'arm', args: [false] }]);
    const list = audit.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.status).toBe('ok');
    expect(list[0]?.result).toBe('ok');
    expect(out.entryId).toBe(list[0]?.id);
  });

  it('sets armedAware on the confirm when the vehicle is armed', async () => {
    const capture: ConfirmOptions[] = [];
    const { deps } = makeDeps({
      confirmCapture: capture,
      getActiveVehicle: () => veh({ armed: true }),
    });
    await runAction(deps, 'disarm');
    expect(capture).toHaveLength(1);
    expect(capture[0]?.armedAware).toBe(true);
    expect(capture[0]?.destructive).toBe(true);
  });

  it('leaves armedAware false when the vehicle is disarmed', async () => {
    const capture: ConfirmOptions[] = [];
    const { deps } = makeDeps({
      confirmCapture: capture,
      getActiveVehicle: () => veh({ armed: false }),
    });
    await runAction(deps, 'arm');
    expect(capture[0]?.armedAware).toBe(false);
  });
});

describe('runAction — gating', () => {
  it('returns blocked (no command, no audit) when the action is disabled', async () => {
    const { deps, command, audit } = makeDeps({ getActiveVehicle: () => veh({ armed: false }) });
    const out = await runAction(deps, 'takeoff', { altM: 5 }); // takeoff needs armed
    expect(out.status).toBe('blocked');
    expect(out.reason).toBe('disabled');
    expect(command.calls).toHaveLength(0);
    expect(audit.list()).toHaveLength(0);
  });

  it('returns blocked when there is no active vehicle', async () => {
    const { deps } = makeDeps({ getActiveVehicle: () => undefined });
    expect((await runAction(deps, 'arm')).status).toBe('blocked');
  });

  it('emergency stop is available while disarmed and force-disarms', async () => {
    const { deps, command } = makeDeps({ getActiveVehicle: () => veh({ armed: false }) });
    const out = await runAction(deps, 'emergencyStop');
    expect(out.status).toBe('ok');
    expect(command.calls).toEqual([{ method: 'arm', args: [false, true] }]);
  });
});

describe('runAction — command coverage', () => {
  it('takeoff passes the prompted altitude', async () => {
    const { deps, command } = makeDeps({ getActiveVehicle: () => veh({ armed: true }) });
    await runAction(deps, 'takeoff', { altM: 30 });
    expect(command.calls).toEqual([{ method: 'takeoff', args: [30] }]);
  });

  it('setMode forwards the mode name', async () => {
    const { deps, command } = makeDeps();
    await runAction(deps, 'setMode', { mode: 'GUIDED' });
    expect(command.calls).toEqual([{ method: 'setMode', args: ['GUIDED'] }]);
  });

  it('pause/resume use DO_PAUSE_CONTINUE via send', async () => {
    const { deps, command } = makeDeps({ getActiveVehicle: () => veh({ armed: true }) });
    await runAction(deps, 'pause');
    await runAction(deps, 'resume');
    expect(command.calls[0]).toEqual({ method: 'send', args: [193, [0]] });
    expect(command.calls[1]).toEqual({ method: 'send', args: [193, [1]] });
  });

  it('changeSpeed uses DO_CHANGE_SPEED with the ground-speed type', async () => {
    const { deps, command } = makeDeps({ getActiveVehicle: () => veh({ armed: true }) });
    await runAction(deps, 'changeSpeed', { speedMs: 8 });
    expect(command.calls).toEqual([{ method: 'send', args: [178, [1, 8, -1, 0, 0, 0, 0]] }]);
  });

  it('restartMission jumps to waypoint 0', async () => {
    const { deps, command } = makeDeps();
    await runAction(deps, 'restartMission');
    expect(command.calls).toEqual([{ method: 'setCurrentWp', args: [0] }]);
  });
});

describe('runAction — non-destructive actions', () => {
  it('setRoi is audited but never confirm-gated', async () => {
    const capture: ConfirmOptions[] = [];
    const { deps, command, audit } = makeDeps({ confirmCapture: capture });
    const out = await runAction(deps, 'setRoi', { lat: 1, lon: 2, altM: 0 });
    expect(out.status).toBe('ok');
    expect(capture).toHaveLength(0); // no confirmation asked
    expect(command.calls).toEqual([{ method: 'setRoi', args: [1, 2, 0] }]);
    expect(audit.list()[0]?.status).toBe('ok');
  });
});

describe('runAction — error capture', () => {
  it('records an error audit entry and returns error without throwing', async () => {
    const { deps, command, audit } = makeDeps({ getActiveVehicle: () => veh({ armed: true }) });
    command.fail.on = true;
    const out = await runAction(deps, 'land');
    expect(out.status).toBe('error');
    expect(out.error).toBeInstanceOf(Error);
    const list = audit.list();
    expect(list[0]?.status).toBe('error');
    expect(list[0]?.result).toBe('boom');
  });
});

describe('gateContextFor', () => {
  it('reports no vehicle', () => {
    expect(gateContextFor(undefined)).toEqual({
      hasVehicle: false,
      armed: false,
      inAir: false,
      vehicleClass: 'unknown',
    });
  });

  it('derives in-air from armed + altitude above the threshold', () => {
    expect(
      gateContextFor(veh({ armed: true, position: { lat: 0, lon: 0, altRelM: 5 } })).inAir,
    ).toBe(true);
    expect(
      gateContextFor(veh({ armed: true, position: { lat: 0, lon: 0, altRelM: 0.2 } })).inAir,
    ).toBe(false);
    expect(
      gateContextFor(veh({ armed: false, position: { lat: 0, lon: 0, altRelM: 50 } })).inAir,
    ).toBe(false);
  });
});
