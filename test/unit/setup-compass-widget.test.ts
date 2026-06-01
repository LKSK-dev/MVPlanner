/**
 * Compass calibration step — component tests (task T5.5; spec plan/04 §4.4
 * compass). Mounts the step's pane over a MOCK `CalibrationClient.compass(...)`
 * and asserts the calibration flow: Start streams live progress, success shows
 * the resolved offsets and settles `done`, a poor-fitness success settles
 * `warning`, and Cancel aborts the signal the seam owns (returning to idle).
 *
 * The step's `render` returns a `JSX.Element`, so this `.test.ts` mounts it via
 * `@solidjs/testing-library`'s `render(() => step.render(api))`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import { createCompassStep } from '../../src/ui/screens/setup/compass';
import type { SetupStep, SetupStepApi, SettledStatus } from '../../src/ui/screens/setup/framework';
import type { CalibrationClient, Param, ParamClient } from '../../src/contracts';

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

afterEach(() => cleanup());

/** A controllable `compass()` mock exposing its progress callback + settlers. */
interface CompassMock {
  readonly compass: CalibrationClient['compass'];
  emit(pct: number, fitness?: number): void;
  resolve(offsets: number[]): void;
  reject(err: unknown): void;
  signal(): AbortSignal | undefined;
  calls(): number;
}

function makeCompassMock(): CompassMock {
  let onProgress: ((pct: number, fitness?: number) => void) | undefined;
  let resolveFn: ((r: { offsets: number[] }) => void) | undefined;
  let rejectFn: ((e: unknown) => void) | undefined;
  let lastSignal: AbortSignal | undefined;
  let count = 0;

  const compass = vi.fn<CalibrationClient['compass']>((progress, signal) => {
    count += 1;
    onProgress = progress;
    lastSignal = signal;
    return new Promise<{ offsets: number[] }>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
      signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
  });

  return {
    compass,
    emit: (pct, fitness): void => onProgress?.(pct, fitness),
    resolve: (offsets): void => resolveFn?.({ offsets }),
    reject: (err): void => rejectFn?.(err),
    signal: (): AbortSignal | undefined => lastSignal,
    calls: (): number => count,
  };
}

/** A minimal {@link SetupStepApi} stub (the shell isn't under test here). */
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

const startBtn = (c: HTMLElement): HTMLButtonElement =>
  c.querySelector<HTMLButtonElement>('[data-testid="compass-start"]')!;
const cancelBtn = (c: HTMLElement): HTMLButtonElement =>
  c.querySelector<HTMLButtonElement>('[data-testid="compass-cancel"]')!;
const status = (c: HTMLElement): string =>
  c.querySelector('[data-testid="compass-status"]')?.textContent ?? '';
const progressNow = (c: HTMLElement): string | null =>
  c.querySelector('[data-testid="compass-progress"]')?.getAttribute('aria-valuenow') ?? null;

describe('createCompassStep', () => {
  it('exposes a compass SetupStep with the safety callout and derived status', () => {
    const mock = makeCompassMock();
    const step = createCompassStep({ calibration: { compass: mock.compass } });
    expect(step.id).toBe('compass');
    expect(step.title).toBe(t('setup.compass.title'));
    expect(step.safetyNote).toContain('orientations');
    expect(step.allowManualComplete).toBe(false);
    expect(step.status?.()).toBe<SettledStatus>('todo');
  });

  it('Start runs compass() and streams live progress', async () => {
    const mock = makeCompassMock();
    const step = createCompassStep({ calibration: { compass: mock.compass } });
    const c = mount(step);

    // Idle: no progress meter yet.
    expect(c.querySelector('[data-testid="compass-progress"]')).toBeNull();

    startBtn(c).click();
    await flush();
    expect(mock.calls()).toBe(1);
    expect(progressNow(c)).toBe('0');
    expect(status(c)).toBe(t('setup.compass.state.running'));
    expect(step.status?.()).toBe<SettledStatus>('todo'); // running → todo (shell shows active)

    mock.emit(45, 5);
    await flush();
    expect(progressNow(c)).toBe('45');
    expect(c.querySelector('[data-testid="compass-fitness"]')?.textContent).toContain('5.0');
  });

  it('completion shows the resolved offsets and settles done', async () => {
    const mock = makeCompassMock();
    const step = createCompassStep({ calibration: { compass: mock.compass } });
    const c = mount(step);

    startBtn(c).click();
    await flush();
    mock.emit(100, 3);
    mock.resolve([12, -34, 56]);
    await flush();

    const offsets = c.querySelector('[data-testid="compass-offsets"]');
    expect(offsets).toBeTruthy();
    expect(offsets?.textContent).toContain('12.0');
    expect(offsets?.textContent).toContain('-34.0');
    expect(offsets?.textContent).toContain('56.0');
    expect(status(c)).toBe(t('setup.compass.state.done'));
    expect(step.status?.()).toBe<SettledStatus>('done');
    // Returns to a Start-again affordance.
    expect(startBtn(c).textContent).toBe(t('setup.compass.restart'));
  });

  it('a poor-fitness success settles warning', async () => {
    const mock = makeCompassMock();
    const step = createCompassStep({ calibration: { compass: mock.compass } });
    const c = mount(step);

    startBtn(c).click();
    await flush();
    mock.emit(100, 99); // well above the default poor-fitness threshold
    mock.resolve([1, 2, 3]);
    await flush();

    expect(step.status?.()).toBe<SettledStatus>('warning');
    expect(status(c)).toBe(t('setup.compass.state.warning'));
    expect(c.querySelector('[data-testid="compass-fitness"]')?.className).toContain('is-poor');
  });

  it('Cancel aborts the injected signal and returns to idle', async () => {
    const mock = makeCompassMock();
    const step = createCompassStep({ calibration: { compass: mock.compass } });
    const c = mount(step);

    startBtn(c).click();
    await flush();
    expect(mock.signal()?.aborted).toBe(false);

    cancelBtn(c).click();
    await flush();

    expect(mock.signal()?.aborted).toBe(true);
    expect(step.status?.()).toBe<SettledStatus>('todo');
    expect(status(c)).toBe(t('setup.compass.state.idle'));
    // Cancel is gone; Start is available again.
    expect(c.querySelector('[data-testid="compass-cancel"]')).toBeNull();
    expect(startBtn(c)).toBeTruthy();
  });

  it('shows optional declination/orientation hints from the param client', async () => {
    const mock = makeCompassMock();
    const params: Pick<ParamClient, 'get' | 'onChange'> = {
      get: (name: string): Param | undefined => {
        if (name === 'COMPASS_AUTODEC') return { name, value: 0, type: 2 };
        if (name === 'COMPASS_DEC') return { name, value: Math.PI / 18, type: 9 }; // 10°
        if (name === 'COMPASS_ORIENT') return { name, value: 8, type: 2 };
        return undefined;
      },
      onChange: (): (() => void) => (): void => undefined,
    };
    const step = createCompassStep({ calibration: { compass: mock.compass }, params });
    const c = mount(step);
    await flush();

    const hints = c.querySelector('[data-testid="compass-hints"]');
    expect(hints).toBeTruthy();
    expect(hints?.textContent).toContain('10.0');
    expect(hints?.textContent).toContain('COMPASS_ORIENT = 8');
  });
});
