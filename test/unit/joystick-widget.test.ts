/**
 * Joystick / gamepad control-panel widget tests (task T8.6; spec plan/04 §4.2
 * joystick). SAFETY-relevant: this panel arms live manual control.
 *
 * Renders {@link Joystick} over a REAL {@link ManualControlService} (pure, no
 * Worker) backed by a capturing `send` + a fake gamepad, with an injected pump
 * scheduler and failsafe target. Exercises the active indicator, the enable/
 * disable toggle, the mapping editors (deadzone/expo/trim/reverse → service),
 * the live readout, and the focus-loss failsafe.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import { Joystick } from '../../src/ui/widgets/joystick';
import {
  createManualControlService,
  NEUTRAL_SHAPE,
  type GamepadSnapshot,
  type ManualControlConfig,
  type ManualControlService,
} from '../../src/mavlink/microservices/manual';
import { settle } from '../helpers';

type Sent = { name: string; fields: Record<string, unknown> };

/** A controllable pump: tests call `run()` to advance one frame. */
function makePump(): { schedule: (cb: () => void) => () => void; run(): void; running(): boolean } {
  let cb: (() => void) | undefined;
  return {
    schedule(fn): () => void {
      cb = fn;
      return () => {
        cb = undefined;
      };
    },
    run(): void {
      cb?.();
    },
    running: () => cb !== undefined,
  };
}

/** A minimal blur-only event target for the failsafe. */
class FakeFailsafeTarget {
  private listeners = new Set<() => void>();
  addEventListener(_type: 'blur', l: () => void): void {
    this.listeners.add(l);
  }
  removeEventListener(_type: 'blur', l: () => void): void {
    this.listeners.delete(l);
  }
  blur(): void {
    for (const l of [...this.listeners]) l();
  }
}

function makeGamepad(): { source: () => GamepadSnapshot | undefined; snap: GamepadSnapshot } {
  const snap: GamepadSnapshot = {
    axes: [0.5, -0.25],
    buttons: [
      { pressed: true, value: 1 },
      { pressed: false, value: 0 },
    ],
    connected: true,
  };
  return { source: () => snap, snap };
}

function makeService(config: Partial<ManualControlConfig> = {}): {
  service: ManualControlService;
  sent: Sent[];
} {
  const sent: Sent[] = [];
  const service = createManualControlService({
    send: (name, fields) => {
      sent.push({ name, fields });
    },
    config,
  });
  return { service, sent };
}

const RC_CONFIG: Partial<ManualControlConfig> = {
  mode: 'rc',
  rcChannels: [{ axis: 0, channel: 1, shape: { ...NEUTRAL_SHAPE } }],
};

function mount(
  props: Partial<Parameters<typeof Joystick>[0]> & { service: ManualControlService },
): {
  container: HTMLElement;
  pump: ReturnType<typeof makePump>;
  failsafe: FakeFailsafeTarget;
} {
  const pump = makePump();
  const failsafe = new FakeFailsafeTarget();
  const gp = makeGamepad();
  const { container } = render(() =>
    createComponent(Joystick, {
      gamepad: gp.source,
      t,
      schedule: pump.schedule,
      failsafeTarget: failsafe,
      ...props,
    }),
  );
  return { container, pump, failsafe };
}

afterEach(() => cleanup());

describe('Joystick widget', () => {
  it('starts inactive and shows the warning + enable control', async () => {
    const { service } = makeService(RC_CONFIG);
    const { container } = mount({ service });
    await settle();

    expect(container.querySelector('.mvp-joystick__status--active')).toBeNull();
    expect(container.querySelector('.mvp-joystick__status--off')?.textContent).toBe(
      t('joystick.inactive'),
    );
    expect(container.querySelector('.mvp-joystick__warning')?.textContent).toBe(
      t('joystick.warning'),
    );
    const toggle = container.querySelector<HTMLButtonElement>('.mvp-joystick__toggle');
    expect(toggle?.textContent).toBe(t('joystick.enable'));
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
  });

  it('enable → shows the prominent "MANUAL CONTROL ACTIVE" indicator', async () => {
    const { service } = makeService(RC_CONFIG);
    const { container } = mount({ service });
    await settle();

    container.querySelector<HTMLButtonElement>('.mvp-joystick__toggle')!.click();
    await settle();

    const banner = container.querySelector('.mvp-joystick__status--active');
    expect(banner?.textContent).toBe(t('joystick.active'));
    expect(banner?.getAttribute('aria-live')).toBe('assertive');
    expect(service.isActive()).toBe(true);
    const toggle = container.querySelector<HTMLButtonElement>('.mvp-joystick__toggle');
    expect(toggle?.textContent).toBe(t('joystick.disable'));
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
  });

  it('disable → returns to the off state and stops the service', async () => {
    const { service } = makeService(RC_CONFIG);
    const { container } = mount({ service });
    await settle();
    const toggle = (): HTMLButtonElement =>
      container.querySelector<HTMLButtonElement>('.mvp-joystick__toggle')!;
    toggle().click();
    await settle();
    expect(service.isActive()).toBe(true);
    toggle().click();
    await settle();
    expect(service.isActive()).toBe(false);
    expect(container.querySelector('.mvp-joystick__status--active')).toBeNull();
  });

  it('renders the RC mapping editors and edits shape through to the service', async () => {
    const { service } = makeService(RC_CONFIG);
    const { container } = mount({ service });
    await settle();

    expect(container.querySelectorAll('.mvp-joystick__map-row')).toHaveLength(1);

    const dz = container.querySelector<HTMLInputElement>('.mvp-joystick__map-deadzone')!;
    dz.value = '0.15';
    dz.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(service.getConfig().rcChannels[0]?.shape.deadzone).toBeCloseTo(0.15, 10);

    const expo = container.querySelector<HTMLInputElement>('.mvp-joystick__map-expo')!;
    expo.value = '0.4';
    expo.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(service.getConfig().rcChannels[0]?.shape.expo).toBeCloseTo(0.4, 10);

    const trim = container.querySelector<HTMLInputElement>('.mvp-joystick__map-trim')!;
    trim.value = '-0.2';
    trim.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(service.getConfig().rcChannels[0]?.shape.trim).toBeCloseTo(-0.2, 10);

    const rev = container.querySelector<HTMLInputElement>('.mvp-joystick__map-reverse')!;
    rev.checked = true;
    rev.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(service.getConfig().rcChannels[0]?.shape.reverse).toBe(true);
  });

  it('edits the channel + gamepad-axis index through to the service', async () => {
    const { service } = makeService(RC_CONFIG);
    const { container } = mount({ service });
    await settle();

    const ch = container.querySelector<HTMLInputElement>('.mvp-joystick__map-channel')!;
    ch.value = '3';
    ch.dispatchEvent(new Event('input', { bubbles: true }));
    const ax = container.querySelector<HTMLInputElement>('.mvp-joystick__map-axis')!;
    ax.value = '2';
    ax.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(service.getConfig().rcChannels[0]?.channel).toBe(3);
    expect(service.getConfig().rcChannels[0]?.axis).toBe(2);
  });

  it('edits rate + require-armed gate through to the service', async () => {
    const { service } = makeService(RC_CONFIG);
    const { container } = mount({ service });
    await settle();

    const rate = container.querySelector<HTMLInputElement>('.mvp-joystick__rate')!;
    rate.value = '40';
    rate.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(service.getConfig().rateHz).toBe(40);

    const armed = container.querySelector<HTMLInputElement>('.mvp-joystick__require-armed')!;
    armed.checked = true;
    armed.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(service.getConfig().requireArmed).toBe(true);
  });

  it('shows the live axis/button readout and pumps the service while active', async () => {
    const { service, sent } = makeService(RC_CONFIG);
    const { container, pump } = mount({ service });
    await settle();

    const axes = (): string[] =>
      [...container.querySelectorAll('.mvp-joystick__axis-value')].map((n) => n.textContent ?? '');
    expect(axes()).toEqual(['0.50', '-0.25']);
    // A pressed button is highlighted.
    expect(container.querySelectorAll('.mvp-joystick__button--pressed')).toHaveLength(1);

    // No pump runs while inactive.
    expect(pump.running()).toBe(false);

    container.querySelector<HTMLButtonElement>('.mvp-joystick__toggle')!.click();
    await settle();
    expect(pump.running()).toBe(true);

    pump.run(); // one frame → a rate-limited send
    await settle();
    expect(sent.some((s) => s.name === 'RC_CHANNELS_OVERRIDE')).toBe(true);
  });

  it('FAILSAFE: a window blur stops manual control', async () => {
    const { service } = makeService(RC_CONFIG);
    const { container, failsafe } = mount({ service });
    await settle();

    container.querySelector<HTMLButtonElement>('.mvp-joystick__toggle')!.click();
    await settle();
    expect(service.isActive()).toBe(true);

    failsafe.blur();
    await settle();
    expect(service.isActive()).toBe(false);
    expect(container.querySelector('.mvp-joystick__status--active')).toBeNull();
  });

  it('renders the manual-mode axis editors when configured for MANUAL_CONTROL', async () => {
    const { service } = makeService({
      mode: 'manual',
      manualAxes: {
        x: { axis: 0, shape: { ...NEUTRAL_SHAPE } },
        y: { axis: 1, shape: { ...NEUTRAL_SHAPE } },
      },
    });
    const { container } = mount({ service });
    await settle();

    const rows = [...container.querySelectorAll('.mvp-joystick__map-row')];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.getAttribute('data-axis')).toBe('x');
    expect(rows[1]?.getAttribute('data-axis')).toBe('y');
  });
});
