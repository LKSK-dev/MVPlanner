/**
 * Failsafe setup step tests (T5.8).
 *
 * Covers the pure parameter-to-section derivation and the Solid component's
 * ParamClient write path for both action dropdowns and numeric thresholds.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import {
  FAILSAFE_PARAM_NAMES,
  FailsafeSetup,
  createFailsafeStep,
  deriveFailsafeSections,
} from '../../src/ui/screens/setup/failsafe';
import type { Param, ParamClient, VehicleClass } from '../../src/contracts';
import { settle } from '../helpers';

const PARAM_TYPE_REAL32 = 9;

function param(name: string, value: number): Param {
  return { name, value, type: PARAM_TYPE_REAL32 };
}

class MockParamClient implements ParamClient {
  readonly writes: Array<{ name: string; value: number }> = [];

  private readonly values = new Map<string, Param>();
  private readonly listeners = new Set<(p: Param) => void>();

  constructor(params: readonly Param[]) {
    for (const p of params) this.values.set(p.name, p);
  }

  fetchAll(
    _onProgress?: (done: number, total: number) => void,
    _signal?: AbortSignal,
  ): Promise<Param[]> {
    return Promise.resolve([...this.values.values()]);
  }

  get(name: string): Param | undefined {
    return this.values.get(name);
  }

  set(name: string, value: number): Promise<void> {
    this.writes.push({ name, value });
    const prev = this.values.get(name);
    const next: Param = prev === undefined ? param(name, value) : { ...prev, value };
    this.values.set(name, next);
    for (const listener of this.listeners) listener(next);
    return Promise.resolve();
  }

  onChange(cb: (p: Param) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

function paramsForAll(): Param[] {
  return FAILSAFE_PARAM_NAMES.map((name, index) => param(name, index));
}

interface Harness {
  readonly container: HTMLElement;
  readonly params: MockParamClient;
}

function mount(params: MockParamClient): Harness {
  const [revision, setRevision] = createSignal(0);
  const { container } = render(() =>
    createComponent(FailsafeSetup, {
      params,
      getVehicleClass: (): VehicleClass => 'copter',
      t,
      revision,
      onChanged: (): void => {
        setRevision((value) => value + 1);
      },
    }),
  );
  return { container, params };
}

function selectFor(container: HTMLElement, name: string): HTMLSelectElement {
  const el = container.querySelector<HTMLSelectElement>(
    `select[aria-label="${t('setup.failsafe.valueFor', { name })}"]`,
  );
  if (el === null) throw new Error(`missing select for ${name}`);
  return el;
}

function inputFor(container: HTMLElement, name: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(
    `input[aria-label="${t('setup.failsafe.valueFor', { name })}"]`,
  );
  if (el === null) throw new Error(`missing input for ${name}`);
  return el;
}

afterEach(() => cleanup());

describe('failsafe section derivation', () => {
  it('groups only present params and skips absent names gracefully', () => {
    const values = new Map<string, Param>([
      ['FS_THR_ENABLE', param('FS_THR_ENABLE', 1)],
      ['FS_THR_VALUE', param('FS_THR_VALUE', 975)],
      ['FS_EKF_THRESH', param('FS_EKF_THRESH', 0.8)],
    ]);

    const sections = deriveFailsafeSections((name) => values.get(name));

    expect(sections.map((section) => section.id)).toEqual(['rc', 'ekfGps']);
    expect(sections[0]?.fields.map((field) => field.name)).toEqual([
      'FS_THR_ENABLE',
      'FS_THR_VALUE',
    ]);
    expect(sections[1]?.fields.map((field) => field.name)).toEqual(['FS_EKF_THRESH']);
  });

  it('derives action dropdown options and curated threshold metadata', () => {
    const values = new Map<string, Param>([
      ['FS_THR_ENABLE', param('FS_THR_ENABLE', 1)],
      ['BATT_LOW_VOLT', param('BATT_LOW_VOLT', 10.5)],
    ]);

    const sections = deriveFailsafeSections((name) => values.get(name));
    const rcAction = sections[0]?.fields[0];
    const batteryThreshold = sections[1]?.fields[0];

    expect(rcAction?.kind).toBe('enum');
    expect(rcAction?.options?.map((option) => option.value)).toEqual([0, 1, 2, 3]);
    expect(batteryThreshold?.kind).toBe('number');
    expect(batteryThreshold?.units).toBe('V');
    expect(batteryThreshold?.increment).toBe(0.1);
  });

  it('createFailsafeStep reports done when supported params are present', () => {
    const params = new MockParamClient([param('FS_THR_ENABLE', 1)]);
    const step = createFailsafeStep({ params, getVehicleClass: () => 'copter' });

    expect(step.id).toBe('failsafe');
    expect(step.status?.()).toBe('done');
  });
});

describe('FailsafeSetup component', () => {
  it('renders the failsafe sections from present parameters', async () => {
    const h = mount(new MockParamClient(paramsForAll()));
    await settle();

    const titles = [...h.container.querySelectorAll('.mvp-failsafe__section-title')].map(
      (el) => el.textContent,
    );
    expect(titles).toEqual([
      t('setup.failsafe.section.rc'),
      t('setup.failsafe.section.battery'),
      t('setup.failsafe.section.gcs'),
      t('setup.failsafe.section.ekfGps'),
    ]);
  });

  it('writes an action dropdown edit to ParamClient.set', async () => {
    const h = mount(new MockParamClient(paramsForAll()));
    await settle();

    const select = selectFor(h.container, 'FS_THR_ENABLE');
    select.value = '3';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(h.params.writes).toContainEqual({ name: 'FS_THR_ENABLE', value: 3 });
  });

  it('writes a threshold input edit to ParamClient.set', async () => {
    const h = mount(new MockParamClient(paramsForAll()));
    await settle();

    const input = inputFor(h.container, 'FS_EKF_THRESH');
    input.value = '0.9';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();

    expect(h.params.writes).toContainEqual({ name: 'FS_EKF_THRESH', value: 0.9 });
  });
});
