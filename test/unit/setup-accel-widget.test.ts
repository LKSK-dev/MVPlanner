/**
 * Accelerometer setup step component tests (task T5.4; spec plan/04 §4.4
 * accel). Mounts the step over a mock `CalibrationClient`: `accel6Point` walks
 * the six faces and each mock `step(face)` waits for the user-position button.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type { CalibrationClient } from '../../src/contracts';
import { createAccelStep } from '../../src/ui/screens/setup/accel';
import type { SetupStep, SetupStepApi, SettledStatus } from '../../src/ui/screens/setup/framework';

const ACCEL_FACES = ['LEVEL', 'LEFT', 'RIGHT', 'NOSEDOWN', 'NOSEUP', 'BACK'] as const;

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

interface MockCalibration {
  readonly accel6Point: CalibrationClient['accel6Point'];
  readonly level: CalibrationClient['level'];
  readonly accelFaces: readonly string[];
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

function makeCalibrationMock(): MockCalibration {
  const seenFaces: string[] = [];
  const accel6Point = vi.fn<CalibrationClient['accel6Point']>(async (step) => {
    for (const face of ACCEL_FACES) {
      seenFaces.push(face);
      await step(face);
    }
  });
  const level = vi.fn<CalibrationClient['level']>(async () => undefined);
  return { accel6Point, level, accelFaces: seenFaces };
}

function mount(step: SetupStep): HTMLElement {
  const { container } = render(() => step.render(makeApi()));
  return container;
}

function button(container: HTMLElement, testId: string): HTMLButtonElement {
  const el = container.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
  if (el === null) throw new Error(`missing button ${testId}`);
  return el;
}

function text(container: HTMLElement, testId: string): string {
  return container.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '';
}

describe('createAccelStep', () => {
  it('exposes an accel SetupStep with derived status', () => {
    const mock = makeCalibrationMock();
    const step = createAccelStep({ calibration: mock });
    expect(step.id).toBe('accel');
    expect(step.title).toBe(t('setup.accel.title'));
    expect(step.safetyNote).toContain('propellers');
    expect(step.allowManualComplete).toBe(false);
    expect(step.status?.()).toBe<SettledStatus>('todo');
  });

  it('walks all six accel faces gated by the positioned button and settles done', async () => {
    const mock = makeCalibrationMock();
    const step = createAccelStep({ calibration: mock });
    const container = mount(step);

    button(container, 'accel-start').click();
    await flush();

    const expected = [
      { label: 'Level', progress: 'face 1 of 6' },
      { label: 'Left side', progress: 'face 2 of 6' },
      { label: 'Right side', progress: 'face 3 of 6' },
      { label: 'Nose down', progress: 'face 4 of 6' },
      { label: 'Nose up', progress: 'face 5 of 6' },
      { label: 'Back', progress: 'face 6 of 6' },
    ] as const;

    for (const entry of expected) {
      const current = text(container, 'accel-current-face');
      expect(current).toContain(entry.label);
      expect(current.toLowerCase()).toContain(entry.progress);
      expect(step.status?.()).toBe<SettledStatus>('todo');
      button(container, 'accel-positioned').click();
      await flush();
    }

    expect(mock.accel6Point).toHaveBeenCalledTimes(1);
    expect(mock.accelFaces).toEqual([...ACCEL_FACES]);
    expect(text(container, 'accel-status')).toBe(t('setup.accel.state.done'));
    expect(step.status?.()).toBe<SettledStatus>('done');
    expect(button(container, 'accel-start').textContent).toBe(t('setup.accel.restart'));
  });

  it('Calibrate Level calls level()', async () => {
    const mock = makeCalibrationMock();
    const step = createAccelStep({ calibration: mock });
    const container = mount(step);

    button(container, 'accel-level').click();
    await flush();

    expect(mock.level).toHaveBeenCalledTimes(1);
    expect(text(container, 'accel-level-status')).toBe(t('setup.accel.level.state.done'));
  });

  it('failed accel calibration settles warning', async () => {
    const accel6Point = vi.fn<CalibrationClient['accel6Point']>(async () => {
      throw new Error('boom');
    });
    const level = vi.fn<CalibrationClient['level']>(async () => undefined);
    const step = createAccelStep({ calibration: { accel6Point, level } });
    const container = mount(step);

    button(container, 'accel-start').click();
    await flush();

    expect(text(container, 'accel-status')).toBe(t('setup.accel.state.warning'));
    expect(container.querySelector('[data-testid="accel-error"]')).toBeTruthy();
    expect(step.status?.()).toBe<SettledStatus>('warning');
  });
});
