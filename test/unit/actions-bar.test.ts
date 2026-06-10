/**
 * Component tests for the Flight actions bar + audit viewer (task T2.7; spec
 * plan/04 §4.2, plan/05 §5.8). Renders the components over mock seams and
 * asserts state-driven `disabled` gating, prompt-driven argument capture, the
 * vehicle-aware mode picker, and the audit panel's list/export/clear.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type { CommandClient } from '../../src/contracts';
import { createAuditLog } from '../../src/core/audit';
import { ActionsBar, AuditPanel, type ActionVehicle } from '../../src/ui/screens/flight/actions';
import { settle } from '../helpers';

interface Call {
  method: string;
  args: readonly unknown[];
}

function mockCommand(): { client: CommandClient; calls: Call[] } {
  const calls: Call[] = [];
  const rec =
    (method: string) =>
    (...args: unknown[]): Promise<void> => {
      calls.push({ method, args });
      return Promise.resolve();
    };
  const client: CommandClient = {
    send: (cmd, params, opts) => {
      calls.push({ method: 'send', args: [cmd, params, opts] });
      return Promise.resolve({ result: 0 });
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
  return { client, calls };
}

afterEach(() => cleanup());

describe('ActionsBar — gating', () => {
  it('enables arm when disarmed and disables in-flight actions', () => {
    const command = mockCommand();
    const audit = createAuditLog();
    const { container } = render(() =>
      createComponent(ActionsBar, {
        command: command.client,
        confirm: () => Promise.resolve(true),
        audit,
        vehicle: () => ({ vehicleClass: 'copter', armed: false }) as ActionVehicle,
        t,
      }),
    );
    const btn = (a: string): HTMLButtonElement =>
      container.querySelector(`[data-action="${a}"]`) as HTMLButtonElement;
    expect(btn('arm').disabled).toBe(false);
    expect(btn('disarm').disabled).toBe(true);
    expect(btn('takeoff').disabled).toBe(true);
    expect(btn('land').disabled).toBe(true);
    // Emergency stop is always available with a vehicle present.
    expect(btn('emergencyStop').disabled).toBe(false);
  });

  it('reactively re-gates when the vehicle arms', async () => {
    const command = mockCommand();
    const audit = createAuditLog();
    const [vehicle, setVehicle] = createSignal<ActionVehicle>({
      vehicleClass: 'copter',
      armed: false,
    });
    const { container } = render(() =>
      createComponent(ActionsBar, {
        command: command.client,
        confirm: () => Promise.resolve(true),
        audit,
        vehicle,
        t,
      }),
    );
    const btn = (a: string): HTMLButtonElement =>
      container.querySelector(`[data-action="${a}"]`) as HTMLButtonElement;
    expect(btn('takeoff').disabled).toBe(true);
    setVehicle({ vehicleClass: 'copter', armed: true });
    await settle();
    expect(btn('takeoff').disabled).toBe(false);
    expect(btn('arm').disabled).toBe(true);
  });
});

describe('ActionsBar — dispatch', () => {
  it('arming confirms then calls command.arm and records an audit entry', async () => {
    const command = mockCommand();
    const audit = createAuditLog();
    const confirm = vi.fn(() => Promise.resolve(true));
    const { container } = render(() =>
      createComponent(ActionsBar, {
        command: command.client,
        confirm,
        audit,
        vehicle: () => ({ vehicleClass: 'copter', armed: false }) as ActionVehicle,
        t,
      }),
    );
    (container.querySelector('[data-action="arm"]') as HTMLButtonElement).click();
    await settle();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(command.calls).toEqual([{ method: 'arm', args: [true] }]);
    expect(audit.list()[0]?.status).toBe('ok');
  });

  it('takeoff gathers altitude from the prompt seam', async () => {
    const command = mockCommand();
    const audit = createAuditLog();
    const { container } = render(() =>
      createComponent(ActionsBar, {
        command: command.client,
        confirm: () => Promise.resolve(true),
        audit,
        vehicle: () => ({ vehicleClass: 'copter', armed: true }) as ActionVehicle,
        t,
        prompt: () => '25',
      }),
    );
    (container.querySelector('[data-action="takeoff"]') as HTMLButtonElement).click();
    await settle();
    expect(command.calls).toEqual([{ method: 'takeoff', args: [25] }]);
  });

  it('a cancelled prompt sends nothing', async () => {
    const command = mockCommand();
    const audit = createAuditLog();
    const { container } = render(() =>
      createComponent(ActionsBar, {
        command: command.client,
        confirm: () => Promise.resolve(true),
        audit,
        vehicle: () => ({ vehicleClass: 'copter', armed: true }) as ActionVehicle,
        t,
        prompt: () => null,
      }),
    );
    (container.querySelector('[data-action="takeoff"]') as HTMLButtonElement).click();
    await settle();
    expect(command.calls).toHaveLength(0);
  });

  it('applies a vehicle-aware flight mode from the picker', async () => {
    const command = mockCommand();
    const audit = createAuditLog();
    const { container } = render(() =>
      createComponent(ActionsBar, {
        command: command.client,
        confirm: () => Promise.resolve(true),
        audit,
        vehicle: () => ({ vehicleClass: 'copter', armed: false }) as ActionVehicle,
        t,
      }),
    );
    const select = container.querySelector('.mvp-actions__mode-select') as HTMLSelectElement;
    // Copter modes come from the vehicle mode map.
    const options = [...select.options].map((o) => o.value);
    expect(options).toContain('GUIDED');
    fireEvent.change(select, { target: { value: 'GUIDED' } });
    await settle();
    (container.querySelector('[data-action="setMode"]') as HTMLButtonElement).click();
    await settle();
    expect(command.calls).toEqual([{ method: 'setMode', args: ['GUIDED'] }]);
  });

  it('resets a stale mode selection when the vehicle class changes (E13)', async () => {
    const command = mockCommand();
    const audit = createAuditLog();
    const [vehicle, setVehicle] = createSignal<ActionVehicle>({
      vehicleClass: 'copter',
      armed: false,
    });
    const { container } = render(() =>
      createComponent(ActionsBar, {
        command: command.client,
        confirm: () => Promise.resolve(true),
        audit,
        vehicle,
        t,
      }),
    );
    const select = container.querySelector('.mvp-actions__mode-select') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'GUIDED' } });
    await settle();
    expect(select.value).toBe('GUIDED');

    // Pick a copter-only mode so the class swap to plane invalidates it.
    fireEvent.change(select, { target: { value: 'FLIP' } });
    await settle();
    setVehicle({ vehicleClass: 'plane', armed: false });
    await settle();
    expect(select.value).toBe('');
    // Apply is disabled again — no stale mode can be sent.
    expect((container.querySelector('[data-action="setMode"]') as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe('AuditPanel', () => {
  it('renders entries newest-first and exports + clears', async () => {
    const audit = createAuditLog({ clock: () => 1000 });
    audit.append({ kind: 'command', summary: 'Arm', status: 'ok', result: 'ok' });
    audit.append({ kind: 'command', summary: 'Disarm', status: 'pending' });

    let exported: { content: string; format: string } | undefined;
    const { container } = render(() =>
      createComponent(AuditPanel, {
        audit,
        t,
        onExport: (content, format) => {
          exported = { content, format };
        },
      }),
    );
    const rows = [...container.querySelectorAll('.mvp-audit__row')];
    expect(rows).toHaveLength(2);
    // Newest-first: 'Disarm' (appended last) on top.
    expect(rows[0]?.querySelector('.mvp-audit__summary')?.textContent).toBe('Disarm');
    expect(rows[1]?.querySelector('.mvp-audit__summary')?.textContent).toBe('Arm');

    (
      container.querySelector('[aria-label="' + t('audit.export.json') + '"]') as HTMLButtonElement
    ).click();
    expect(exported?.format).toBe('json');
    expect(exported?.content).toContain('Arm');

    (
      container.querySelector('[aria-label="' + t('audit.clear') + '"]') as HTMLButtonElement
    ).click();
    await settle();
    expect(container.querySelectorAll('.mvp-audit__row')).toHaveLength(0);
    expect(container.querySelector('.mvp-audit__empty')).toBeTruthy();
  });

  it('updates live as new entries are appended', async () => {
    const audit = createAuditLog();
    const { container } = render(() => createComponent(AuditPanel, { audit, t }));
    expect(container.querySelector('.mvp-audit__empty')).toBeTruthy();
    audit.append({ kind: 'command', summary: 'RTL', status: 'ok' });
    await settle();
    expect(container.querySelectorAll('.mvp-audit__row')).toHaveLength(1);
  });
});
