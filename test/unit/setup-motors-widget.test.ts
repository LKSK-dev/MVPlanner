/**
 * Motor-test setup component tests (T5.10). Mounts the real `createMotorsStep`
 * through the Setup wizard shell with a MOCK `command.send` + MOCK `confirm`,
 * and asserts the SAFETY GATING: nothing is sent unless the props-removed gate
 * is acknowledged, the vehicle is disarmed, and the user confirms.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type { CommandClient, ConfirmOptions, Param, ParamClient } from '../../src/contracts';
import { WizardShell } from '../../src/ui/screens/setup/framework';
import {
  createMotorsStep,
  MAV_CMD_DO_MOTOR_TEST,
  MOTOR_TEST_ORDER_SEQUENCE,
} from '../../src/ui/screens/setup/motors';
import { settle } from '../helpers';

interface SentCommand {
  readonly cmd: number;
  readonly params: number[];
}

class MockCommand implements Pick<CommandClient, 'send'> {
  readonly sent: SentCommand[] = [];
  readonly send = vi.fn<CommandClient['send']>((cmd: number, params: number[]) => {
    this.sent.push({ cmd, params: [...params] });
    return Promise.resolve({ result: 0 });
  });
}

function makeConfirm(answer: boolean): {
  fn: (opts: ConfirmOptions) => Promise<boolean>;
  calls: ConfirmOptions[];
} {
  const calls: ConfirmOptions[] = [];
  const fn = vi.fn<(opts: ConfirmOptions) => Promise<boolean>>((opts: ConfirmOptions) => {
    calls.push(opts);
    return Promise.resolve(answer);
  });
  return { fn, calls };
}

function makeParamClient(): ParamClient & { readonly writes: { name: string; value: number }[] } {
  const writes: { name: string; value: number }[] = [];
  return {
    writes,
    fetchAll: (): Promise<Param[]> => Promise.resolve([]),
    get: (): Param | undefined => undefined,
    set: (name: string, value: number): Promise<void> => {
      writes.push({ name, value });
      return Promise.resolve();
    },
    onChange: (): (() => void) => (): void => {},
  };
}

interface MountOpts {
  readonly command: Pick<CommandClient, 'send'>;
  readonly confirm: (opts: ConfirmOptions) => Promise<boolean>;
  readonly params?: ParamClient;
  readonly armed?: boolean;
}

function mountMotors(opts: MountOpts): HTMLElement {
  const step = createMotorsStep({
    command: opts.command,
    confirm: opts.confirm,
    ...(opts.params ? { params: opts.params } : {}),
    getVehicleClass: () => 'copter',
    getArmed: () => opts.armed ?? false,
    t,
  });
  const { container } = render(() => createComponent(WizardShell, { steps: [step], t }));
  return container;
}

function click(container: HTMLElement, testId: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (button === null) throw new Error(`missing button ${testId}`);
  button.click();
}

function ackProps(container: HTMLElement): void {
  const checkbox = container.querySelector<HTMLInputElement>('[data-testid="motors-ack"]');
  if (checkbox === null) throw new Error('missing ack checkbox');
  checkbox.checked = true;
  checkbox.dispatchEvent(new Event('change', { bubbles: true }));
}

function isDisabled(container: HTMLElement, testId: string): boolean {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (button === null) throw new Error(`missing button ${testId}`);
  return button.disabled;
}

afterEach(() => cleanup());

describe('createMotorsStep — safety gating', () => {
  it('disables motor-test controls until props are acknowledged', async () => {
    const command = new MockCommand();
    const { fn } = makeConfirm(true);
    const container = mountMotors({ command, confirm: fn });
    await settle();

    expect(isDisabled(container, 'motors-test-1')).toBe(true);
    expect(isDisabled(container, 'motors-test-all')).toBe(true);

    ackProps(container);
    await settle();

    expect(isDisabled(container, 'motors-test-1')).toBe(false);
    expect(isDisabled(container, 'motors-test-all')).toBe(false);
  });

  it('sends NOTHING when the confirmation is declined', async () => {
    const command = new MockCommand();
    const { fn, calls } = makeConfirm(false);
    const container = mountMotors({ command, confirm: fn });
    await settle();

    ackProps(container);
    await settle();
    click(container, 'motors-test-1');
    await settle();

    expect(calls.length).toBe(1);
    expect(command.sent).toHaveLength(0);
  });

  it('sends DO_MOTOR_TEST(209) with the right params when confirmed', async () => {
    const command = new MockCommand();
    const { fn, calls } = makeConfirm(true);
    const container = mountMotors({ command, confirm: fn });
    await settle();

    ackProps(container);
    await settle();
    click(container, 'motors-test-2');
    await settle();

    expect(command.sent).toHaveLength(1);
    const sent = command.sent[0];
    expect(sent).toBeDefined();
    if (sent === undefined) throw new Error('no command sent');
    expect(sent.cmd).toBe(MAV_CMD_DO_MOTOR_TEST);
    // [instance, throttleType=percent, throttle%, timeout, motorCount, order, 0]
    expect(sent.params[0]).toBe(2);
    expect(sent.params[1]).toBe(0);
    expect(sent.params[2]).toBe(5);
    expect(sent.params[3]).toBe(2);

    // Confirmation is destructive + armed-aware.
    const opts = calls[0];
    expect(opts).toBeDefined();
    if (opts === undefined) throw new Error('no confirm call');
    expect(opts.destructive).toBe(true);
    expect(opts.armedAware).toBe(true);
  });

  it('"test all" confirms once then sends ONE sequential-test command', async () => {
    const command = new MockCommand();
    const { fn, calls } = makeConfirm(true);
    const container = mountMotors({ command, confirm: fn });
    await settle();

    ackProps(container);
    await settle();
    click(container, 'motors-test-all');
    await settle();

    // Copter default = 4 motors → one confirm, ONE DO_MOTOR_TEST encoding the
    // whole sequence (param5 = motorCount, param6 = MOTOR_TEST_ORDER_SEQUENCE);
    // N single-motor sends would spin every motor simultaneously.
    expect(calls.length).toBe(1);
    expect(command.sent).toHaveLength(1);
    const sent = command.sent[0];
    if (sent === undefined) throw new Error('no command sent');
    expect(sent.cmd).toBe(MAV_CMD_DO_MOTOR_TEST);
    expect(sent.params[0]).toBe(1);
    expect(sent.params[4]).toBe(4);
    expect(sent.params[5]).toBe(MOTOR_TEST_ORDER_SEQUENCE);
  });

  it('emergency stop sends zero-throttle DO_MOTOR_TEST without confirmation', async () => {
    const command = new MockCommand();
    const { fn, calls } = makeConfirm(true);
    const container = mountMotors({ command, confirm: fn });
    await settle();

    // No ack, no confirm — emergency stop must still work.
    click(container, 'motors-stop');
    await settle();

    expect(calls.length).toBe(0);
    expect(command.sent.length).toBeGreaterThan(0);
    for (const sent of command.sent) {
      expect(sent.cmd).toBe(MAV_CMD_DO_MOTOR_TEST);
      expect(sent.params[2]).toBe(0); // throttle
      expect(sent.params[3]).toBe(0); // timeout
    }
  });

  it('disables motor-test controls while armed and warns', async () => {
    const command = new MockCommand();
    const { fn } = makeConfirm(true);
    const container = mountMotors({ command, confirm: fn, armed: true });
    await settle();

    ackProps(container);
    await settle();

    expect(container.querySelector('[data-testid="motors-armed-warning"]')).not.toBeNull();
    expect(isDisabled(container, 'motors-test-1')).toBe(true);

    click(container, 'motors-test-1');
    await settle();
    expect(command.sent).toHaveLength(0);
  });

  it('writes the ESC calibration param only behind confirmation', async () => {
    const command = new MockCommand();
    const params = makeParamClient();
    const { fn, calls } = makeConfirm(true);
    const container = mountMotors({ command, confirm: fn, params });
    await settle();

    click(container, 'motors-esc-arm');
    await settle();

    expect(calls.length).toBe(1);
    expect(params.writes).toEqual([{ name: 'ESC_CALIBRATION', value: 3 }]);

    click(container, 'motors-esc-reset');
    await settle();
    expect(params.writes).toContainEqual({ name: 'ESC_CALIBRATION', value: 0 });
  });

  it('declined ESC calibration writes nothing', async () => {
    const command = new MockCommand();
    const params = makeParamClient();
    const { fn } = makeConfirm(false);
    const container = mountMotors({ command, confirm: fn, params });
    await settle();

    click(container, 'motors-esc-arm');
    await settle();
    expect(params.writes).toHaveLength(0);
  });

  it('degrades ESC calibration to instructions without a ParamClient', async () => {
    const command = new MockCommand();
    const { fn } = makeConfirm(true);
    const container = mountMotors({ command, confirm: fn });
    await settle();

    expect(container.querySelector('[data-testid="motors-esc-unavailable"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="motors-esc-arm"]')).toBeNull();
  });
});
