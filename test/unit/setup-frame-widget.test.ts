/**
 * Frame setup component tests: mount the SetupStep with a mock ParamClient and
 * assert Copter selectors reflect current values and write the right params.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type { Param, ParamClient } from '../../src/contracts';
import type { VehicleClass } from '../../src/contracts';
import { WizardShell } from '../../src/ui/screens/setup/framework';
import { createFrameStep, type FrameParamName } from '../../src/ui/screens/setup/frame';

const PARAM_TYPE_INT32 = 6;

interface SetCall {
  readonly name: string;
  readonly value: number;
}

class MockParamClient implements ParamClient {
  readonly setCalls: SetCall[] = [];
  readonly fetchAll = vi.fn<ParamClient['fetchAll']>(async () => [...this.cache.values()]);

  private readonly cache = new Map<string, Param>();
  private readonly listeners = new Set<(p: Param) => void>();

  constructor(initial: Partial<Record<FrameParamName, number>>) {
    for (const [name, value] of Object.entries(initial)) {
      if (value !== undefined) this.cache.set(name, { name, value, type: PARAM_TYPE_INT32 });
    }
  }

  get(name: string): Param | undefined {
    return this.cache.get(name);
  }

  async set(name: string, value: number): Promise<void> {
    this.setCalls.push({ name, value });
    const param: Param = { name, value, type: this.cache.get(name)?.type ?? PARAM_TYPE_INT32 };
    this.cache.set(name, param);
    for (const listener of this.listeners) listener(param);
  }

  onChange(cb: (p: Param) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mountFrameStep(
  params: MockParamClient,
  vehicleClass: VehicleClass = 'copter',
): HTMLElement {
  const step = createFrameStep({ params, getVehicleClass: () => vehicleClass });
  const { container } = render(() => createComponent(WizardShell, { steps: [step], t }));
  return container;
}

function selectByParam(container: HTMLElement, param: FrameParamName): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(`[data-param="${param}"] select`);
  if (select === null) throw new Error(`missing select for ${param}`);
  return select;
}

function selectByLabel(container: HTMLElement, label: string): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`);
  if (select === null) throw new Error(`missing select ${label}`);
  return select;
}

describe('createFrameStep widget', () => {
  it('renders copter class/type selectors and reflects current values', async () => {
    const params = new MockParamClient({ FRAME_CLASS: 1, FRAME_TYPE: 12 });
    const container = mountFrameStep(params);
    await settle();

    const classSelect = selectByLabel(container, t('setup.frame.class.selectLabel'));
    const typeSelect = selectByLabel(container, t('setup.frame.type.selectLabel'));

    expect(classSelect.value).toBe('1');
    expect(typeSelect.value).toBe('12');
    expect(classSelect.selectedOptions[0]?.textContent).toBe(t('setup.frame.copter.class.quad'));
    expect(typeSelect.selectedOptions[0]?.textContent).toBe(
      t('setup.frame.copter.type.betaFlightX'),
    );
    expect(params.fetchAll).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.mvp-setup-frame__status')?.getAttribute('data-status')).toBe(
      'done',
    );
  });

  it('writes FRAME_CLASS and updates the displayed selection', async () => {
    const params = new MockParamClient({ FRAME_CLASS: 1, FRAME_TYPE: 1 });
    const container = mountFrameStep(params);
    await settle();

    const classSelect = selectByLabel(container, t('setup.frame.class.selectLabel'));
    fireEvent.change(classSelect, { target: { value: '2' } });
    await settle();

    expect(params.setCalls).toEqual([{ name: 'FRAME_CLASS', value: 2 }]);
    expect(classSelect.value).toBe('2');
    expect(classSelect.selectedOptions[0]?.textContent).toBe(t('setup.frame.copter.class.hexa'));
  });

  it('writes FRAME_TYPE without changing frame-class completion', async () => {
    const params = new MockParamClient({ FRAME_CLASS: 3, FRAME_TYPE: 1 });
    const container = mountFrameStep(params);
    await settle();

    const typeSelect = selectByLabel(container, t('setup.frame.type.selectLabel'));
    fireEvent.change(typeSelect, { target: { value: '14' } });
    await settle();

    expect(params.setCalls).toEqual([{ name: 'FRAME_TYPE', value: 14 }]);
    expect(typeSelect.value).toBe('14');
    expect(container.querySelector('.mvp-setup-frame__status')?.getAttribute('data-status')).toBe(
      'done',
    );
  });

  it('renders editable QuadPlane Q_FRAME_CLASS/Q_FRAME_TYPE selectors when Q_ENABLE is on', async () => {
    const params = new MockParamClient({ Q_ENABLE: 1, Q_FRAME_CLASS: 1, Q_FRAME_TYPE: 1 });
    const container = mountFrameStep(params, 'plane');
    await settle();

    const classSelect = selectByParam(container, 'Q_FRAME_CLASS');
    const typeSelect = selectByParam(container, 'Q_FRAME_TYPE');

    expect(classSelect.value).toBe('1');
    expect(classSelect.selectedOptions[0]?.textContent).toBe(t('setup.frame.quadplane.class.quad'));
    expect(typeSelect.value).toBe('1');
    expect(typeSelect.selectedOptions[0]?.textContent).toBe(t('setup.frame.copter.type.x'));
    expect(container.querySelector('.mvp-setup-frame__status')?.getAttribute('data-status')).toBe(
      'done',
    );
  });

  it('writes Q_FRAME_CLASS and Q_FRAME_TYPE through the param client', async () => {
    const params = new MockParamClient({ Q_ENABLE: 1, Q_FRAME_CLASS: 1, Q_FRAME_TYPE: 0 });
    const container = mountFrameStep(params, 'plane');
    await settle();

    fireEvent.change(selectByParam(container, 'Q_FRAME_CLASS'), { target: { value: '3' } });
    await settle();
    fireEvent.change(selectByParam(container, 'Q_FRAME_TYPE'), { target: { value: '2' } });
    await settle();

    expect(params.setCalls).toEqual([
      { name: 'Q_FRAME_CLASS', value: 3 },
      { name: 'Q_FRAME_TYPE', value: 2 },
    ]);
    expect(selectByParam(container, 'Q_FRAME_CLASS').value).toBe('3');
    expect(selectByParam(container, 'Q_FRAME_TYPE').value).toBe('2');
  });

  it('shows the fixed-wing state (no Q frame) when Q_ENABLE is off', async () => {
    const params = new MockParamClient({ Q_ENABLE: 0 });
    const container = mountFrameStep(params, 'plane');
    await settle();

    expect(container.querySelector('[data-param="Q_FRAME_CLASS"]')).toBeNull();
    expect(container.querySelector('.mvp-setup-frame__fixed-wing')?.textContent).toBe(
      t('setup.frame.fixedWing.body'),
    );
    expect(
      container.querySelector('.mvp-setup-frame__parameters-only')?.getAttribute('data-mode'),
    ).toBe('fixedWing');
    expect(container.querySelector('.mvp-setup-frame__status')?.getAttribute('data-status')).toBe(
      'na',
    );
  });
});
