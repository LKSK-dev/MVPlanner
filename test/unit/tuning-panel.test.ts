/**
 * PID / tuning panel tests (task T3.6; spec plan/04 §4.5 tuning).
 *
 * Mounts {@link TuningPanel} over a MOCK {@link ParamClient} (returns a copter
 * tuning set, records `set()` calls) + a one-method {@link ParamMetaResolver}
 * mock and a copter `vehicle` accessor, then asserts the MUST behaviour: the
 * Copter PID rows render with metadata, fetching populates the values, an edit
 * marks the row modified and `Write changed` calls `set()` ONLY for the edited
 * param, and autotune routes through the injected {@link CommandClient}.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createComponent, createSignal } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import { TuningPanel, type TuningVehicle } from '../../src/ui/screens/config/tuning';
import { MAV_CMD_DO_AUTOTUNE_ENABLE } from '../../src/ui/screens/config/tuning';
import type { CommandClient, Param, ParamClient } from '../../src/contracts';
import type { ParamMeta, ParamMetaResolver } from '../../src/ui/widgets/paramgrid';
import { MAV_PARAM_TYPE } from '../../src/mavlink/microservices/param';

const REAL = MAV_PARAM_TYPE.REAL32;

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function param(name: string, value: number): Param {
  return { name, value, type: REAL };
}

function resolver(table: Record<string, ParamMeta>): ParamMetaResolver {
  return { get: (name) => table[name] };
}

/** Mock ParamClient: serves a fixed copter set from cache, records `set()`. */
class MockParamClient implements ParamClient {
  readonly sets: Array<{ name: string; value: number }> = [];
  private listeners = new Set<(p: Param) => void>();
  constructor(private readonly data: readonly Param[]) {}

  async fetchAll(onProgress?: (done: number, total: number) => void): Promise<Param[]> {
    const n = this.data.length;
    this.data.forEach((_, i) => onProgress?.(i + 1, n));
    return this.data.map((p) => ({ ...p }));
  }
  get(name: string): Param | undefined {
    const found = this.data.find((p) => p.name === name);
    return found ? { ...found } : undefined;
  }
  async set(name: string, value: number): Promise<void> {
    this.sets.push({ name, value });
    for (const cb of this.listeners) cb(param(name, value));
  }
  onChange(cb: (p: Param) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
}

/** Mock CommandClient recording `send` calls (only `send` is exercised). */
function mockCommand(): { client: CommandClient; sends: Array<{ cmd: number; params: number[] }> } {
  const sends: Array<{ cmd: number; params: number[] }> = [];
  const reject = (): Promise<never> => Promise.reject(new Error('unused'));
  const client: CommandClient = {
    send: (cmd, params) => {
      sends.push({ cmd, params });
      return Promise.resolve({ result: 0 });
    },
    arm: () => reject(),
    setMode: () => reject(),
    takeoff: () => reject(),
    land: () => reject(),
    rtl: () => reject(),
    guidedGoto: () => reject(),
    setRoi: () => reject(),
    clearRoi: () => reject(),
    setCurrentWp: () => reject(),
  };
  return { client, sends };
}

const META = resolver({
  ATC_RAT_RLL_P: {
    min: 0,
    max: 0.35,
    increment: 0.005,
    units: '',
    description: 'Roll rate P gain',
  },
  ATC_RAT_PIT_P: { min: 0, max: 0.35, increment: 0.005 },
});

const COPTER_SET: readonly Param[] = [
  param('ATC_RAT_RLL_P', 0.135),
  param('ATC_RAT_PIT_P', 0.135),
  param('ATC_RAT_YAW_P', 0.18),
];

function input(container: HTMLElement, name: string): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>(
    `input.mvp-tuning__input[data-param="${name}"]`,
  );
  if (!el) throw new Error(`no value input for ${name}`);
  return el;
}

afterEach(cleanup);

describe('TuningPanel — copter PID tables', () => {
  function mount(client: ParamClient, extra: { command?: CommandClient } = {}): HTMLElement {
    const [vehicle] = createSignal<TuningVehicle | undefined>({ vehicleClass: 'copter' });
    const { container } = render(() =>
      createComponent(TuningPanel, { client, meta: META, t, vehicle, ...extra }),
    );
    return container;
  }

  it('renders the copter rate PID rows with metadata', () => {
    const container = mount(new MockParamClient(COPTER_SET));
    // The rate group is present and the classic rate rows render.
    expect(container.querySelector('[data-group="rate"]')).toBeTruthy();
    expect(container.querySelector('tr[data-param="ATC_RAT_RLL_P"]')).toBeTruthy();
    expect(container.querySelector('tr[data-param="ATC_RAT_YAW_P"]')).toBeTruthy();
    // Angle + position groups for copter are present too.
    expect(container.querySelector('[data-group="angle"]')).toBeTruthy();
    expect(container.querySelector('[data-group="position"]')).toBeTruthy();
    // Description from metadata is shown.
    const row = container.querySelector('tr[data-param="ATC_RAT_RLL_P"]')!;
    expect(row.textContent).toContain('Roll rate P gain');
    // Seeded from the shared client cache on mount.
    expect(input(container, 'ATC_RAT_RLL_P').value).toBe('0.135');
  });

  it('Fetch populates values and an edit + Write changed writes only the edited param', async () => {
    const client = new MockParamClient(COPTER_SET);
    const container = mount(client);
    await settle();

    // Fetch refreshes from the client.
    const fetchBtn = container.querySelector<HTMLButtonElement>('[data-testid="tuning-fetch"]')!;
    fetchBtn.click();
    await settle();
    await settle();
    expect(input(container, 'ATC_RAT_PIT_P').value).toBe('0.135');

    // Edit one rate gain → row modified.
    const el = input(container, 'ATC_RAT_RLL_P');
    el.value = '0.2';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const row = container.querySelector<HTMLElement>('tr[data-param="ATC_RAT_RLL_P"]')!;
    expect(row.classList.contains('is-modified')).toBe(true);

    // Write changed → only the edited param is set.
    const writeBtn = container.querySelector<HTMLButtonElement>('[data-testid="tuning-write"]')!;
    expect(writeBtn.disabled).toBe(false);
    writeBtn.click();
    await settle();
    await settle();
    expect(client.sets).toEqual([{ name: 'ATC_RAT_RLL_P', value: 0.2 }]);
  });

  it('autotune start sends MAV_CMD_DO_AUTOTUNE_ENABLE via the command client', async () => {
    const cmd = mockCommand();
    const container = mount(new MockParamClient(COPTER_SET), { command: cmd.client });
    const startBtn = container.querySelector<HTMLButtonElement>(
      '[data-testid="tuning-autotune-start"]',
    )!;
    startBtn.click();
    await settle();
    await settle();
    expect(cmd.sends).toEqual([{ cmd: MAV_CMD_DO_AUTOTUNE_ENABLE, params: [1] }]);
  });

  it('falls back to copter tables when no vehicle is active', () => {
    const [vehicle] = createSignal<TuningVehicle | undefined>(undefined);
    const { container } = render(() =>
      createComponent(TuningPanel, {
        client: new MockParamClient([]),
        meta: META,
        t,
        vehicle,
      }),
    );
    expect(container.querySelector('.mvp-tuning__hint')).toBeTruthy();
    expect(container.querySelector('[data-group="rate"]')).toBeTruthy();
  });
});
