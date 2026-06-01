/**
 * Flight modes setup component tests: mount the real SetupStep with a mock
 * ParamClient and assert Copter mode dropdowns reflect/write FLTMODEn params.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type { Param, ParamClient } from '../../src/contracts';
import { WizardShell } from '../../src/ui/screens/setup/framework';
import { createModesStep } from '../../src/ui/screens/setup/modes';

const PARAM_TYPE_INT32 = 6;

interface ParamWrite {
  readonly name: string;
  readonly value: number;
}

type ParamListener = (param: Param) => void;

class MockParamClient implements ParamClient {
  readonly writes: ParamWrite[] = [];

  private readonly values = new Map<string, Param>();
  private readonly listeners = new Set<ParamListener>();

  constructor(initial: Readonly<Record<string, number>>) {
    for (const [name, value] of Object.entries(initial)) {
      this.values.set(name, { name, value, type: PARAM_TYPE_INT32 });
    }
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
    const param: Param = { name, value, type: this.values.get(name)?.type ?? PARAM_TYPE_INT32 };
    this.values.set(name, param);
    for (const listener of this.listeners) listener(param);
    return Promise.resolve();
  }

  onChange(cb: ParamListener): () => void {
    this.listeners.add(cb);
    return (): void => {
      this.listeners.delete(cb);
    };
  }
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function mountModes(client: ParamClient): HTMLElement {
  const step = createModesStep({ params: client, getVehicleClass: () => 'copter' });
  const { container } = render(() => createComponent(WizardShell, { steps: [step], t }));
  return container;
}

function modeSelect(container: HTMLElement, position: number): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(
    `select[data-testid="modes-position-${position}"]`,
  );
  if (select === null) throw new Error(`missing mode select ${position}`);
  return select;
}

function channelSelect(container: HTMLElement): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>('select[data-testid="modes-channel"]');
  if (select === null) throw new Error('missing FLTMODE_CH select');
  return select;
}

afterEach(() => cleanup());

describe('createModesStep widget', () => {
  it('renders six copter mode dropdowns and reflects current values', async () => {
    const params = new MockParamClient({
      FLTMODE_CH: 5,
      FLTMODE1: 0,
      FLTMODE2: 5,
      FLTMODE3: 6,
      FLTMODE4: 9,
      FLTMODE5: 3,
      FLTMODE6: 4,
    });
    const container = mountModes(params);
    await settle();

    const selects = container.querySelectorAll<HTMLSelectElement>(
      'select[data-testid^="modes-position-"]',
    );
    expect(selects).toHaveLength(6);
    expect(channelSelect(container).value).toBe('5');
    expect(modeSelect(container, 1).value).toBe('0');
    expect(modeSelect(container, 2).value).toBe('5');
    expect(modeSelect(container, 6).value).toBe('4');
    expect(modeSelect(container, 1).textContent).toContain('STABILIZE (0)');
    expect(modeSelect(container, 1).textContent).toContain('LOITER (5)');
    expect(modeSelect(container, 1).textContent).toContain('RTL (6)');
    expect(container.querySelector('.mvp-setup-modes__status')?.getAttribute('data-status')).toBe(
      'done',
    );
  });

  it('writes FLTMODEn when a switch-position dropdown changes', async () => {
    const params = new MockParamClient({
      FLTMODE_CH: 5,
      FLTMODE1: 0,
      FLTMODE2: 5,
      FLTMODE3: 3,
      FLTMODE4: 9,
      FLTMODE5: 3,
      FLTMODE6: 4,
    });
    const container = mountModes(params);
    await settle();

    const select = modeSelect(container, 3);
    fireEvent.change(select, { target: { value: '6' } });
    await settle();

    expect(params.writes).toContainEqual({ name: 'FLTMODE3', value: 6 });
    expect(select.value).toBe('6');
  });
});
