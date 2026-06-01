/**
 * Component tests for the MAVLink message / command sender.
 *
 * Mounts the Solid widget over a tiny deterministic dialect and a typed mock
 * sender, then exercises metadata-driven rendering and the emitted send calls.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import type { DialectTable } from '../../src/contracts';
import { t } from '../../src/core/i18n';
import { MessageSender, type MsgSenderSend } from '../../src/ui/widgets/msg-sender';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const TEST_DIALECT: DialectTable = {
  name: 'test',
  messages: {
    0: {
      id: 0,
      name: 'HEARTBEAT',
      crcExtra: 50,
      fields: [
        { name: 'custom_mode', type: 'uint32_t' },
        { name: 'type', type: 'uint8_t', enum: 'MAV_TYPE' },
      ],
    },
    30: {
      id: 30,
      name: 'ATTITUDE',
      crcExtra: 39,
      fields: [{ name: 'roll', type: 'float', units: 'rad' }],
    },
  },
  enums: {
    MAV_TYPE: [
      { value: 1, name: 'MAV_TYPE_FIXED_WING' },
      { value: 2, name: 'MAV_TYPE_QUADROTOR' },
    ],
    MAV_CMD: [
      {
        value: 178,
        name: 'MAV_CMD_DO_CHANGE_SPEED',
        params: ['Speed Type', 'Speed', 'Throttle', 'Relative', '', '', ''],
      },
    ],
    SPEED_TYPE: [
      { value: 0, name: 'SPEED_TYPE_AIRSPEED' },
      { value: 1, name: 'SPEED_TYPE_GROUNDSPEED' },
    ],
  },
};

interface Harness {
  readonly container: HTMLElement;
  readonly send: ReturnType<typeof vi.fn<MsgSenderSend>>;
}

function mount(): Harness {
  const send = vi.fn<MsgSenderSend>();
  const { container } = render(() =>
    createComponent(MessageSender, { send, t, dialects: [TEST_DIALECT] }),
  );
  return { container, send };
}

function picker(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>('.mvp-msgsender__picker-select');
  if (select === null) throw new Error('missing picker');
  return select;
}

function fieldInput(container: HTMLElement, name: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    `.mvp-msgsender__field-input[aria-label="${name} ${name}"]`,
  );
  if (input === null) throw new Error(`missing input ${name}`);
  return input;
}

function fieldSelect(container: HTMLElement, name: string): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(
    `.mvp-msgsender__field-select[aria-label="${name} ${name}"]`,
  );
  if (select === null) throw new Error(`missing select ${name}`);
  return select;
}

function lastSend(send: ReturnType<typeof vi.fn<MsgSenderSend>>): Parameters<MsgSenderSend> {
  const call = send.mock.calls.at(-1);
  if (call === undefined) throw new Error('mock was not called');
  return call;
}

afterEach(() => cleanup());

describe('MessageSender widget', () => {
  it('renders selected message fields and sends parsed field values', async () => {
    const h = mount();
    await settle();

    fieldInput(h.container, 'custom_mode').value = '42';
    fieldInput(h.container, 'custom_mode').dispatchEvent(new Event('input', { bubbles: true }));
    const type = fieldSelect(h.container, 'type');
    type.value = '2';
    type.dispatchEvent(new Event('change', { bubbles: true }));

    h.container.querySelector<HTMLButtonElement>('.mvp-msgsender__send')?.click();
    await settle();

    const [name, fields, options] = lastSend(h.send);
    expect(name).toBe('HEARTBEAT');
    expect(fields).toEqual({ custom_mode: 42, type: 2 });
    expect(options).toEqual({ signed: false });
  });

  it('populates enum dropdown options from the dialect', async () => {
    const h = mount();
    await settle();
    const options = [...fieldSelect(h.container, 'type').querySelectorAll('option')].map(
      (option) => option.textContent ?? '',
    );
    expect(options.some((label) => label.includes('MAV_TYPE_QUADROTOR'))).toBe(true);
  });

  it('renders MAV_CMD labelled params and sends COMMAND_LONG with the command id', async () => {
    const h = mount();
    await settle();
    const select = picker(h.container);
    select.value = 'command:178';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    const speedType = h.container.querySelector<HTMLSelectElement>(
      '.mvp-msgsender__field-select[aria-label="Speed Type param1"]',
    );
    expect(speedType).toBeTruthy();
    speedType!.value = '1';
    speedType!.dispatchEvent(new Event('change', { bubbles: true }));

    const speed = h.container.querySelector<HTMLInputElement>(
      '.mvp-msgsender__field-input[aria-label="Speed param2"]',
    );
    expect(speed).toBeTruthy();
    speed!.value = '12.5';
    speed!.dispatchEvent(new Event('input', { bubbles: true }));

    h.container.querySelector<HTMLButtonElement>('.mvp-msgsender__send')?.click();
    await settle();

    const [name, fields] = lastSend(h.send);
    expect(name).toBe('COMMAND_LONG');
    expect(fields.command).toBe(178);
    expect(fields.param1).toBe(1);
    expect(fields.param2).toBe(12.5);
    expect(fields.target_system).toBe(1);
    expect(fields.target_component).toBe(1);
  });
});
