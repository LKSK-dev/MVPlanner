/**
 * Setup wizard framework — WizardShell component tests (task T5.2; spec plan/04
 * §4.4, plan/05 §5.4). Renders the shell over a STUB step registry (no concrete
 * calibration/param logic) and asserts the UI contract: it renders the step list
 * with statuses, switching the active step swaps the pane, a per-step safety
 * callout shows when a note is present, and completion reflects status.
 *
 * Steps return plain DOM nodes (this is a `.test.ts`, so no JSX) — Solid inserts
 * a returned `Node` directly, which satisfies `SetupStep.render`'s `JSX.Element`.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createComponent, createSignal, type Setter } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import { WizardShell, type SettledStatus } from '../../src/ui/screens/setup/framework';
import type { SetupStep } from '../../src/ui/screens/setup/framework';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => cleanup());

/** Build a `<p class>` content node for a step. */
function bodyNode(cls: string, text: string): Node {
  const p = document.createElement('p');
  p.className = cls;
  p.textContent = text;
  return p;
}

interface Harness {
  steps: SetupStep[];
  setFrameStatus: Setter<SettledStatus>;
}

function makeHarness(): Harness {
  const [frameStatus, setFrameStatus] = createSignal<SettledStatus>('todo');
  const frame: SetupStep = {
    id: 'frame',
    title: 'Frame',
    safetyNote: 'Remove the props before continuing.',
    status: frameStatus,
    render: (): Node => bodyNode('t-frame-body', 'frame content'),
  };
  const accel: SetupStep = {
    id: 'accel',
    title: 'Accel',
    status: (): SettledStatus => 'done',
    render: (): Node => bodyNode('t-accel-body', 'accel content'),
  };
  return { steps: [frame, accel], setFrameStatus };
}

function mount(steps: SetupStep[]): HTMLElement {
  const { container } = render(() => createComponent(WizardShell, { steps, t }));
  return container;
}

describe('WizardShell', () => {
  it('renders the step list with completion-state badges', async () => {
    const { steps } = makeHarness();
    const container = mount(steps);
    await settle();

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('.mvp-setup-wizard__steptab')];
    expect(tabs.map((b) => b.querySelector('.mvp-setup-wizard__steptitle')?.textContent)).toEqual([
      'Frame',
      'Accel',
    ]);
    // First step is active+todo → 'active' badge; second derives 'done'.
    expect(tabs[0]?.dataset.status).toBe('active');
    expect(tabs[1]?.dataset.status).toBe('done');
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('shows the active step content and its safety callout', async () => {
    const { steps } = makeHarness();
    const container = mount(steps);
    await settle();

    expect(container.querySelector('.t-frame-body')?.textContent).toBe('frame content');
    expect(container.querySelector('.t-accel-body')).toBeNull();
    const callout = container.querySelector('.mvp-setup-callout');
    expect(callout).toBeTruthy();
    expect(callout?.getAttribute('data-kind')).toBe('safety');
    expect(container.querySelector('.mvp-setup-callout__note')?.textContent).toBe(
      'Remove the props before continuing.',
    );
  });

  it('swaps the pane when another step is activated', async () => {
    const { steps } = makeHarness();
    const container = mount(steps);
    await settle();

    const accelTab = [
      ...container.querySelectorAll<HTMLButtonElement>('.mvp-setup-wizard__steptab'),
    ][1];
    accelTab?.click();
    await settle();

    expect(container.querySelector('.t-accel-body')?.textContent).toBe('accel content');
    expect(container.querySelector('.t-frame-body')).toBeNull();
    // Accel has no safetyNote → no callout in the pane now.
    expect(container.querySelector('.mvp-setup-callout')).toBeNull();
    expect(container.querySelector('.mvp-setup-wizard__panetitle')?.textContent).toBe('Accel');
  });

  it('reflects completion in the progress line and reacts to status changes', async () => {
    const { steps, setFrameStatus } = makeHarness();
    const container = mount(steps);
    await settle();

    const progress = (): string =>
      container.querySelector('.mvp-setup-wizard__progress')?.textContent ?? '';
    // Only accel ('done') is complete initially.
    expect(progress()).toBe(t('setup.progress', { done: 1, total: 2 }));

    setFrameStatus('done');
    await settle();
    expect(progress()).toBe(t('setup.progress', { done: 2, total: 2 }));
    // Active frame is now 'done', so its badge is no longer 'active'.
    const frameTab = container.querySelector<HTMLButtonElement>('.mvp-setup-wizard__steptab');
    expect(frameTab?.dataset.status).toBe('done');
  });

  it('marks a step complete via the built-in button and advances', async () => {
    const { steps } = makeHarness();
    const container = mount(steps);
    await settle();

    const completeBtn = container.querySelector<HTMLButtonElement>(
      '.mvp-setup-wizard__navbtn--complete',
    );
    expect(completeBtn?.textContent).toBe(t('setup.markComplete'));
    completeBtn?.click();
    await settle();

    // Advanced to accel, and frame's explicit override now reads done.
    expect(container.querySelector('.t-accel-body')).toBeTruthy();
    const frameTab = container.querySelector<HTMLButtonElement>('.mvp-setup-wizard__steptab');
    expect(frameTab?.dataset.status).toBe('done');
    expect(container.querySelector('.mvp-setup-wizard__progress')?.textContent).toBe(
      t('setup.progress', { done: 2, total: 2 }),
    );
  });

  it('renders the empty state for an empty registry', async () => {
    const container = mount([]);
    await settle();
    expect(container.querySelector('.mvp-setup-wizard__empty')?.textContent).toBe(t('setup.empty'));
  });
});
