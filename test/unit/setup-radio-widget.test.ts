/**
 * Radio setup component tests (T5.6). Mounts createRadioStep with mock
 * CalibrationClient.radio and ParamClient set/get seams, then verifies live bars,
 * captured ranges, and saved `RCn_*` writes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import { createRadioStep } from '../../src/ui/screens/setup/radio';
import type { SetupStep, SetupStepApi, SettledStatus } from '../../src/ui/screens/setup/framework';
import type { CalibrationClient, Param, ParamClient } from '../../src/contracts';

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface RadioMock {
  readonly radio: CalibrationClient['radio'];
  emit(channels: readonly number[]): void;
  signal(): AbortSignal | undefined;
  calls(): number;
}

function makeRadioMock(): RadioMock {
  let onChannels: ((ch: number[]) => void) | undefined;
  let lastSignal: AbortSignal | undefined;
  let count = 0;

  const radio = vi.fn<CalibrationClient['radio']>((cb, signal) => {
    count += 1;
    onChannels = cb;
    lastSignal = signal;
    return new Promise<void>((resolve) => {
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
  });

  return {
    radio,
    emit: (channels): void => onChannels?.([...channels]),
    signal: (): AbortSignal | undefined => lastSignal,
    calls: (): number => count,
  };
}

interface ParamSetCall {
  readonly name: string;
  readonly value: number;
}

interface MockParams extends Pick<ParamClient, 'set' | 'get'> {
  readonly setCalls: ParamSetCall[];
}

function makeParams(): MockParams {
  const setCalls: ParamSetCall[] = [];
  const get = vi.fn<ParamClient['get']>((name: string): Param | undefined => {
    if (name === 'RC1_MIN') return { name, value: 1100, type: 6 };
    if (name === 'RC1_MAX') return { name, value: 1900, type: 6 };
    if (name === 'RC1_TRIM') return { name, value: 1500, type: 6 };
    return undefined;
  });
  const set = vi.fn<ParamClient['set']>(async (name: string, value: number): Promise<void> => {
    setCalls.push({ name, value });
  });
  return { get, set, setCalls };
}

function makeApi(): SetupStepApi {
  return {
    t,
    setStatus: (): void => undefined,
    markComplete: (): void => undefined,
    clearStatus: (): void => undefined,
    next: (): void => undefined,
    prev: (): void => undefined,
    isActive: (): boolean => true,
  };
}

function mount(step: SetupStep): HTMLElement {
  const { container } = render(() => step.render(makeApi()));
  return container;
}

function button(container: HTMLElement, testId: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (found === null) throw new Error(`missing button ${testId}`);
  return found;
}

function text(container: HTMLElement, testId: string): string {
  return container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';
}

describe('createRadioStep', () => {
  it('exposes a radio SetupStep with derived status', () => {
    const radio = makeRadioMock();
    const params = makeParams();
    const step = createRadioStep({ calibration: { radio: radio.radio }, params });

    expect(step.id).toBe('radio');
    expect(step.title).toBe(t('setup.radio.title'));
    expect(step.safetyNote).toContain('propellers');
    expect(step.allowManualComplete).toBe(false);
    expect(step.status?.()).toBe<SettledStatus>('todo');
  });

  it('renders live bars, updates captured min/max, and saves RC params', async () => {
    const radio = makeRadioMock();
    const params = makeParams();
    const step = createRadioStep({ calibration: { radio: radio.radio }, params });
    const container = mount(step);

    expect(container.querySelector('[data-testid="radio-bars"]')).toBeNull();
    button(container, 'radio-start').click();
    await flush();

    expect(radio.calls()).toBe(1);
    expect(step.status?.()).toBe<SettledStatus>('todo');
    expect(
      container.querySelector('[data-testid="radio-status"]')?.getAttribute('data-status'),
    ).toBe('active');

    radio.emit([1500, 1500]);
    await flush();
    expect(container.querySelector('[data-testid="radio-channel-1"]')).toBeTruthy();
    expect(text(container, 'radio-current-1')).toBe('1500');
    expect(text(container, 'radio-min-1')).toBe('1500');
    expect(text(container, 'radio-max-1')).toBe('1500');
    expect(text(container, 'radio-trim-1')).toBe('1500');

    radio.emit([1000, 2000]);
    radio.emit([2000, 1200]);
    radio.emit([1505, 1495]);
    await flush();

    expect(text(container, 'radio-min-1')).toBe('1000');
    expect(text(container, 'radio-max-1')).toBe('2000');
    expect(text(container, 'radio-trim-1')).toBe('1505');
    expect(text(container, 'radio-min-2')).toBe('1200');
    expect(text(container, 'radio-max-2')).toBe('2000');
    expect(text(container, 'radio-trim-2')).toBe('1495');

    button(container, 'radio-save').click();
    await flush();

    expect(params.setCalls).toEqual([
      { name: 'RC1_MIN', value: 1000 },
      { name: 'RC1_MAX', value: 2000 },
      { name: 'RC1_TRIM', value: 1505 },
      { name: 'RC2_MIN', value: 1200 },
      { name: 'RC2_MAX', value: 2000 },
      { name: 'RC2_TRIM', value: 1495 },
    ]);
    expect(radio.signal()?.aborted).toBe(true);
    expect(step.status?.()).toBe<SettledStatus>('done');
    expect(text(container, 'radio-status')).toBe(t('setup.radio.status.done'));
  });
});
