/**
 * Battery setup component tests (T5.9). Mounts the real `createBatteryStep`
 * through the Setup wizard shell with a mock ParamClient.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type { Param, ParamClient } from '../../src/contracts';
import { WizardShell } from '../../src/ui/screens/setup/framework';
import { createBatteryStep } from '../../src/ui/screens/setup/battery';
import { settle } from '../helpers';

interface ParamWrite {
  readonly name: string;
  readonly value: number;
}

interface MockParamClient extends ParamClient {
  readonly writes: readonly ParamWrite[];
  emit(name: string, value: number): void;
}

type ParamListener = (param: Param) => void;

function param(name: string, value: number): Param {
  return { name, value, type: 9 };
}

function makeMockParamClient(initial: Readonly<Record<string, number>>): MockParamClient {
  const values = new Map<string, number>(Object.entries(initial));
  const listeners = new Set<ParamListener>();
  const writes: ParamWrite[] = [];

  const notify = (name: string, value: number): void => {
    const update = param(name, value);
    for (const listener of listeners) listener(update);
  };

  return {
    writes,
    fetchAll: (): Promise<Param[]> =>
      Promise.resolve([...values].map(([name, value]) => param(name, value))),
    get: (name: string): Param | undefined => {
      const value = values.get(name);
      return value === undefined ? undefined : param(name, value);
    },
    set: (name: string, value: number): Promise<void> => {
      writes.push({ name, value });
      values.set(name, value);
      notify(name, value);
      return Promise.resolve();
    },
    onChange: (cb: ParamListener): (() => void) => {
      listeners.add(cb);
      return (): void => {
        listeners.delete(cb);
      };
    },
    emit: (name: string, value: number): void => {
      values.set(name, value);
      notify(name, value);
    },
  };
}

function mountBattery(client: ParamClient): HTMLElement {
  const step = createBatteryStep({ params: client, t });
  const { container } = render(() => createComponent(WizardShell, { steps: [step], t }));
  return container;
}

function input(container: HTMLElement, testId: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(`[data-testid="${testId}"]`);
  if (el === null) throw new Error(`missing input ${testId}`);
  return el;
}

function select(container: HTMLElement, testId: string): HTMLSelectElement {
  const el = container.querySelector<HTMLSelectElement>(`[data-testid="${testId}"]`);
  if (el === null) throw new Error(`missing select ${testId}`);
  return el;
}

function changeSelect(el: HTMLSelectElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function click(container: HTMLElement, testId: string): void {
  const button = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (button === null) throw new Error(`missing button ${testId}`);
  button.click();
}

afterEach(() => cleanup());

describe('createBatteryStep', () => {
  it('reflects current ParamClient values and onChange updates', async () => {
    const client = makeMockParamClient({
      BATT_MONITOR: 4,
      BATT_VOLT_PIN: 11,
      BATT_CURR_PIN: 12,
      BATT_VOLT_MULT: 18.182,
      BATT_AMP_PERVLT: 36.364,
      BATT_AMP_OFFSET: 0.2,
      BATT_CAPACITY: 5000,
    });
    const container = mountBattery(client);
    await settle();

    expect(select(container, 'battery-monitor').value).toBe('4');
    expect(input(container, 'battery-voltage-pin').value).toBe('11');
    expect(input(container, 'battery-current-pin').value).toBe('12');
    expect(input(container, 'battery-voltage-multiplier').value).toBe('18.182');
    expect(input(container, 'battery-amps-per-volt').value).toBe('36.364');
    expect(input(container, 'battery-amp-offset').value).toBe('0.2');
    expect(input(container, 'battery-capacity').value).toBe('5000');

    client.emit('BATT_CAPACITY', 5200);
    await settle();
    expect(input(container, 'battery-capacity').value).toBe('5200');
  });

  it('toggles current-sensing fields when monitor type changes', async () => {
    const client = makeMockParamClient({
      BATT_MONITOR: 3,
      BATT_VOLT_PIN: 2,
      BATT_VOLT_MULT: 10.1,
    });
    const container = mountBattery(client);
    await settle();

    expect(container.querySelector('[data-testid="battery-current-pin"]')).toBeNull();
    expect(container.querySelector('[data-testid="battery-capacity"]')).toBeNull();

    changeSelect(select(container, 'battery-monitor'), '4');
    await settle();

    expect(input(container, 'battery-current-pin').value).toBe('3');
    expect(input(container, 'battery-capacity').value).toBe('0');
    expect(client.writes).toContainEqual({ name: 'BATT_MONITOR', value: 4 });
  });

  it('applies a power-module preset by writing the expected params', async () => {
    const client = makeMockParamClient({ BATT_MONITOR: 4 });
    const container = mountBattery(client);
    await settle();

    changeSelect(select(container, 'battery-preset'), 'pixhawk-standard');
    click(container, 'battery-apply-preset');
    await settle();

    expect(client.writes).toEqual([
      { name: 'BATT_VOLT_PIN', value: 2 },
      { name: 'BATT_CURR_PIN', value: 3 },
      { name: 'BATT_VOLT_MULT', value: 10.1 },
      { name: 'BATT_AMP_PERVLT', value: 17 },
      { name: 'BATT_AMP_OFFSET', value: 0 },
    ]);
    expect(input(container, 'battery-voltage-multiplier').value).toBe('10.1');
    expect(input(container, 'battery-amps-per-volt').value).toBe('17');
  });
});
