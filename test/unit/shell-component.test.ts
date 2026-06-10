import { afterEach, describe, it, expect } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import type { AppState, Store, VehicleState } from '../../src/contracts';
import type { Capabilities } from '../../src/core/capabilities';
import { createAppStore } from '../../src/core/store';
import { t } from '../../src/core/i18n';
import {
  Shell,
  createUiRegistry,
  type ShellContextValue,
  type ShellRegistry,
} from '../../src/ui/shell';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Macrotask turn: flush the store's coalesced patch microtask + effects. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Minimal armed/disarmed vehicle for confirm `armedAware` coverage. */
function makeVehicle(overrides: Partial<VehicleState> = {}): VehicleState {
  return {
    sysid: 1,
    compid: 1,
    mavType: 2,
    autopilot: 3,
    vehicleClass: 'copter',
    armed: false,
    mode: 'STABILIZE',
    attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
    link: { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false },
    lastHeartbeatMs: 0,
    ...overrides,
  };
}

function makeCaps(overrides: Partial<Capabilities> = {}): Capabilities {
  return {
    webSerial: true,
    webBluetooth: false,
    webUsb: false,
    fileSystemAccess: false,
    wasm: true,
    secureContext: true,
    offscreenCanvas: false,
    crossOriginIsolated: false,
    webSpeech: false,
    gamepad: false,
    ...overrides,
  };
}

interface Harness {
  ctx: ShellContextValue;
  store: Store<AppState>;
  registry: ShellRegistry;
}

function makeCtx(caps: Capabilities = makeCaps()): Harness {
  const store = createAppStore();
  const registry = createUiRegistry();
  const ctx: ShellContextValue = { store, registry, capabilities: caps, panelApi: { store, t } };
  return { ctx, store, registry };
}

function mount(ctx: ShellContextValue): HTMLElement {
  const { container } = render(() => createComponent(Shell, { ctx }));
  return container;
}

function key(target: EventTarget, init: KeyboardEventInit): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
}

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('data-theme');
  // The capability notice records its dismissal in sessionStorage (session
  // scope); reset between tests so cases don't leak the dismissed flag.
  try {
    sessionStorage.clear();
  } catch {
    /* sessionStorage unavailable in this environment */
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Shell — navigation', () => {
  it('switches the persisted activeScreen when a nav button is clicked', async () => {
    const { ctx, store } = makeCtx();
    const container = mount(ctx);

    const planBtn = [...container.querySelectorAll<HTMLButtonElement>('.mvp-nav-item')].find(
      (b) => b.textContent === 'Plan',
    );
    expect(planBtn).toBeTruthy();
    expect(store.get().layout.activeScreen).toBe('flight');

    planBtn!.click();
    await settle();

    expect(store.get().layout.activeScreen).toBe('plan');
    expect(planBtn!.getAttribute('aria-current')).toBe('page');
    expect(container.querySelector('[data-screen="plan"]')).toBeTruthy();
  });
});

describe('Shell — command palette', () => {
  it('opens on Ctrl-K, filters, and runs a command', async () => {
    const { ctx, store } = makeCtx();
    const container = mount(ctx);

    // Palette closed initially.
    expect(container.querySelector('.mvp-palette')).toBeNull();

    key(window, { key: 'k', ctrlKey: true });
    await settle();

    const palette = container.querySelector('[role="dialog"].mvp-palette');
    expect(palette).toBeTruthy();

    const input = container.querySelector<HTMLInputElement>('.mvp-palette__input');
    expect(input).toBeTruthy();
    input!.value = 'logs';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    const items = container.querySelectorAll('.mvp-palette__item');
    expect(items).toHaveLength(1);
    expect(items[0]?.textContent).toContain('Go to Logs');

    key(input!, { key: 'Enter' });
    await settle();

    expect(store.get().layout.activeScreen).toBe('logs');
    // Palette closes after running a command.
    expect(container.querySelector('.mvp-palette')).toBeNull();
  });

  it('also opens via Meta-K and closes on Escape', async () => {
    const { ctx } = makeCtx();
    const container = mount(ctx);

    key(window, { key: 'k', metaKey: true });
    await settle();
    expect(container.querySelector('.mvp-palette')).toBeTruthy();

    const input = container.querySelector<HTMLInputElement>('.mvp-palette__input');
    key(input!, { key: 'Escape' });
    await settle();
    expect(container.querySelector('.mvp-palette')).toBeNull();
  });
});

describe('Shell — alert center', () => {
  it('renders a toast inside the ARIA live region', async () => {
    const { ctx, registry } = makeCtx();
    const container = mount(ctx);

    registry.toast('info', 'Hello toast');
    await settle();

    const region = container.querySelector('.mvp-toasts');
    expect(region?.getAttribute('role')).toBe('region');
    // The container is a plain wrapper; the per-toast role is the live region.
    expect(region?.hasAttribute('aria-live')).toBe(false);

    const toast = container.querySelector('.mvp-toast');
    expect(toast?.getAttribute('role')).toBe('status');
    expect(toast?.textContent).toContain('Hello toast');
  });

  it('uses an assertive alert role for error toasts', async () => {
    const { ctx, registry } = makeCtx();
    const container = mount(ctx);

    registry.toast('error', 'Boom');
    await settle();

    expect(container.querySelector('.mvp-toast--error')?.getAttribute('role')).toBe('alert');
  });

  it('keeps the live-region wrapper free of a redundant aria-live', async () => {
    const { ctx, registry } = makeCtx();
    const container = mount(ctx);

    registry.toast('info', 'Hi');
    await settle();

    const region = container.querySelector('.mvp-toasts');
    // Per-toast role=status/alert are the live regions; the wrapper must not be.
    expect(region?.hasAttribute('aria-live')).toBe(false);
  });

  it('removes a toast from the live region when dismissed', async () => {
    const { ctx, registry } = makeCtx();
    const container = mount(ctx);

    registry.toast('info', 'Dismiss me');
    await settle();
    expect(container.querySelectorAll('.mvp-toast')).toHaveLength(1);

    const close = container.querySelector<HTMLButtonElement>('.mvp-toast__close');
    close!.click();
    await settle();
    expect(container.querySelectorAll('.mvp-toast')).toHaveLength(0);
  });
});

describe('Shell — confirm dialog', () => {
  it('renders a labelled, modal alertdialog and resolves true on Confirm', async () => {
    const { ctx, registry } = makeCtx();
    const container = mount(ctx);

    const result = registry.confirm({ title: 'Delete it?', body: 'This cannot be undone.' });
    await settle();

    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog!.getAttribute('aria-modal')).toBe('true');
    // Labelled by its title, described by its body.
    const titleId = dialog!.getAttribute('aria-labelledby')!;
    const bodyId = dialog!.getAttribute('aria-describedby')!;
    expect(container.querySelector(`#${titleId}`)?.textContent).toBe('Delete it?');
    expect(container.querySelector(`#${bodyId}`)?.textContent).toBe('This cannot be undone.');
    // Focus moved into the dialog on mount.
    expect(dialog!.contains(document.activeElement)).toBe(true);

    const confirmBtn = container.querySelector<HTMLButtonElement>('.mvp-btn--primary');
    confirmBtn!.click();
    await expect(result).resolves.toBe(true);
    await settle();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('resolves false when Cancel is clicked', async () => {
    const { ctx, registry } = makeCtx();
    const container = mount(ctx);

    const result = registry.confirm({ title: 'Proceed?', body: 'Are you sure?' });
    await settle();

    const cancelBtn = [
      ...container.querySelectorAll<HTMLButtonElement>('.mvp-modal__actions .mvp-btn'),
    ].find((b) => !b.classList.contains('mvp-btn--primary'));
    expect(cancelBtn).toBeTruthy();
    cancelBtn!.click();
    await expect(result).resolves.toBe(false);
  });

  it('resolves false when Escape is pressed inside the dialog', async () => {
    const { ctx, registry } = makeCtx();
    const container = mount(ctx);

    const result = registry.confirm({ title: 'Proceed?', body: 'Are you sure?' });
    await settle();

    const dialog = container.querySelector<HTMLElement>('[role="alertdialog"]');
    key(dialog!, { key: 'Escape' });
    await expect(result).resolves.toBe(false);
    await settle();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('resolves a pending confirm with false when a second confirm arrives (D1)', async () => {
    const { ctx, registry } = makeCtx();
    const container = mount(ctx);

    const first = registry.confirm({ title: 'First?', body: 'one' });
    const second = registry.confirm({ title: 'Second?', body: 'two' });

    // The first caller never hangs: it resolves false when replaced.
    await expect(first).resolves.toBe(false);
    await settle();

    // The swapped request renders fresh content (keyed <Show>).
    expect(container.querySelector('#mvp-confirm-title')?.textContent).toBe('Second?');
    expect(container.querySelector('#mvp-confirm-body')?.textContent).toBe('two');

    container.querySelector<HTMLButtonElement>('.mvp-btn--primary')!.click();
    await expect(second).resolves.toBe(true);
  });

  it('shows the armed warning when armedAware and a vehicle is armed', async () => {
    const { ctx, registry, store } = makeCtx();
    const container = mount(ctx);
    store.patch((s) => {
      s.vehicles[1] = makeVehicle({ armed: true });
    });
    await settle();

    void registry.confirm({ title: 'Disarm?', body: 'Stops motors.', armedAware: true });
    await settle();

    expect(container.querySelector('.mvp-modal__warn')?.textContent).toBe(
      t('confirm.armedWarning'),
    );
  });
});

describe('Shell — palette focus management', () => {
  it('focuses the input on open and restores focus to the trigger on Escape', async () => {
    const { ctx } = makeCtx();
    const container = mount(ctx);

    const trigger = container.querySelector<HTMLButtonElement>('.mvp-palette-btn');
    expect(trigger).toBeTruthy();
    trigger!.focus();
    expect(document.activeElement).toBe(trigger);

    trigger!.click();
    await settle();

    const input = container.querySelector<HTMLInputElement>('.mvp-palette__input');
    expect(document.activeElement).toBe(input);

    key(input!, { key: 'Escape' });
    await settle();
    expect(container.querySelector('.mvp-palette')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('restores focus to the trigger after running a command', async () => {
    const { ctx } = makeCtx();
    const container = mount(ctx);

    const trigger = container.querySelector<HTMLButtonElement>('.mvp-palette-btn');
    trigger!.focus();
    trigger!.click();
    await settle();

    const input = container.querySelector<HTMLInputElement>('.mvp-palette__input');
    key(input!, { key: 'Enter' });
    await settle();

    expect(container.querySelector('.mvp-palette')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('moves the active option and updates aria-activedescendant on arrow keys', async () => {
    const { ctx } = makeCtx();
    const container = mount(ctx);

    key(window, { key: 'k', ctrlKey: true });
    await settle();

    const input = container.querySelector<HTMLInputElement>('.mvp-palette__input');
    const firstId = input!.getAttribute('aria-activedescendant');
    const firstActive = container.querySelector('.mvp-palette__item--active');
    expect(firstId).toBe(firstActive?.getAttribute('id'));

    key(input!, { key: 'ArrowDown' });
    await settle();
    const secondId = input!.getAttribute('aria-activedescendant');
    expect(secondId).not.toBe(firstId);
    expect(secondId).toBe(
      container.querySelector('.mvp-palette__item--active')?.getAttribute('id'),
    );

    key(input!, { key: 'ArrowUp' });
    await settle();
    expect(input!.getAttribute('aria-activedescendant')).toBe(firstId);
  });

  it('traps Tab inside the palette (keeps focus on the input)', async () => {
    const { ctx } = makeCtx();
    const container = mount(ctx);

    key(window, { key: 'k', ctrlKey: true });
    await settle();
    const input = container.querySelector<HTMLInputElement>('.mvp-palette__input');
    input!.focus();

    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab' });
    input!.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('renders the no-results empty state for a non-matching query', async () => {
    const { ctx } = makeCtx();
    const container = mount(ctx);

    key(window, { key: 'k', ctrlKey: true });
    await settle();
    const input = container.querySelector<HTMLInputElement>('.mvp-palette__input');
    input!.value = 'zzz-no-such-command-zzz';
    input!.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    expect(container.querySelectorAll('.mvp-palette__item')).toHaveLength(0);
    const empty = container.querySelector('.mvp-palette__empty');
    expect(empty?.textContent).toBe(t('palette.noResults'));
    expect(input!.getAttribute('aria-activedescendant')).toBeNull();
  });
});

describe('Shell — status chips', () => {
  it('renders live armed/mode/battery for the active vehicle (D2)', async () => {
    const { ctx, store } = makeCtx();
    const container = mount(ctx);

    // No vehicle: muted placeholders.
    const status = container.querySelector('.mvp-status')!;
    expect(status.textContent).toContain(t('status.disarmed'));
    expect(status.textContent).toContain(t('status.unknown'));

    store.patch((s) => {
      s.activeSysid = 1;
      s.vehicles[1] = makeVehicle({
        armed: true,
        mode: 'LOITER',
        battery: { voltageV: 12.6, remainingPct: 81 },
      });
    });
    await settle();

    expect(status.textContent).toContain(t('status.armed'));
    expect(status.textContent).toContain('LOITER');
    expect(status.textContent).toContain('12.6 V');
    expect(status.textContent).toContain('81%');
  });
});

describe('Shell — theme wiring', () => {
  it('applies the settings theme and updates on change', async () => {
    const { ctx, store } = makeCtx();
    mount(ctx);
    await settle();

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    store.patch((s) => {
      s.settings.theme = 'light';
    });
    await settle();

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('Shell — capabilities notice', () => {
  it('shows a non-blocking notice when Web Serial is unsupported', () => {
    const { ctx } = makeCtx(makeCaps({ webSerial: false }));
    const container = mount(ctx);
    expect(container.querySelector('[data-testid="cap-notice"]')).toBeTruthy();
  });

  it('hides the notice when Web Serial is supported', () => {
    const { ctx } = makeCtx(makeCaps({ webSerial: true }));
    const container = mount(ctx);
    expect(container.querySelector('[data-testid="cap-notice"]')).toBeNull();
  });

  it('dismisses the notice via an accessible close control', () => {
    const { ctx } = makeCtx(makeCaps({ webSerial: false }));
    const container = mount(ctx);

    const dismiss = container.querySelector<HTMLButtonElement>(
      '[data-testid="cap-notice-dismiss"]',
    );
    expect(dismiss).toBeTruthy();
    // Accessible: a focusable <button> with an aria-label.
    expect(dismiss!.tagName).toBe('BUTTON');
    expect(dismiss!.getAttribute('aria-label')).toBe(t('cap.dismiss'));

    dismiss!.click();
    expect(container.querySelector('[data-testid="cap-notice"]')).toBeNull();
  });

  it('stays dismissed across an in-session remount, then returns next session', () => {
    // Dismiss in the first mounted shell.
    const first = makeCtx(makeCaps({ webSerial: false }));
    const firstContainer = mount(first.ctx);
    firstContainer.querySelector<HTMLButtonElement>('[data-testid="cap-notice-dismiss"]')!.click();
    expect(firstContainer.querySelector('[data-testid="cap-notice"]')).toBeNull();
    cleanup();

    // A fresh shell in the SAME session (e.g. an in-session reload) stays hidden.
    const second = makeCtx(makeCaps({ webSerial: false }));
    const secondContainer = mount(second.ctx);
    expect(secondContainer.querySelector('[data-testid="cap-notice"]')).toBeNull();
    cleanup();

    // Next session (sessionStorage cleared on app launch) the notice returns.
    sessionStorage.clear();
    const third = makeCtx(makeCaps({ webSerial: false }));
    const thirdContainer = mount(third.ctx);
    expect(thirdContainer.querySelector('[data-testid="cap-notice"]')).toBeTruthy();
  });
});
