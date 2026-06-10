/**
 * Setup screen assembly tests (task T5.12; spec plan/04 §4.4, plan/05 §5.4
 * Setup). Renders {@link SetupScreen} over MOCK app/connection-scoped services
 * (no host, no Worker) and asserts the composition: the wizard lists all eight
 * steps in order, switching the active step mounts that step's pane, the
 * parameter-fetch affordance triggers `ParamClient.fetchAll`, and the motor-test
 * step's destructive `confirm` gating still holds through the assembly. A
 * shell-integration case asserts navigating to Setup mounts the real screen over
 * the placeholder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type {
  CalibrationClient,
  CommandClient,
  ConfirmOptions,
  Param,
  ParamClient,
} from '../../src/contracts';
import type { Capabilities } from '../../src/core/capabilities';
import { createAppStore } from '../../src/core/store';
import { SetupScreen, createSetupScreenPanel } from '../../src/ui/screens/setup';
import {
  Shell,
  createUiRegistry,
  setScreenPanel,
  type ShellContextValue,
} from '../../src/ui/shell';
import { settle } from '../helpers';

afterEach(() => cleanup());

// --------------------------------------------------------------------------
// Mocks
// --------------------------------------------------------------------------

/** Inert CalibrationClient — the assembly tests do not drive a calibration. */
function stubCalibration(): CalibrationClient {
  return {
    accel6Point: (): Promise<void> => Promise.resolve(),
    level: (): Promise<void> => Promise.resolve(),
    compass: (): Promise<{ offsets: number[] }> => Promise.resolve({ offsets: [] }),
    gyro: (): Promise<void> => Promise.resolve(),
    radio: (): Promise<void> => Promise.resolve(),
  };
}

interface MockParam extends ParamClient {
  readonly fetchAllSpy: ReturnType<typeof vi.fn>;
}

/** ParamClient over an in-memory cache; `fetchAll` is spied. */
function makeParam(): MockParam {
  const cache = new Map<string, Param>();
  const fetchAllSpy = vi.fn<ParamClient['fetchAll']>(() => Promise.resolve([...cache.values()]));
  return {
    fetchAllSpy,
    fetchAll: fetchAllSpy,
    get: (name: string): Param | undefined => cache.get(name),
    set: (name: string, value: number): Promise<void> => {
      cache.set(name, { name, value, type: 9 });
      return Promise.resolve();
    },
    onChange: (): (() => void) => (): void => {},
  };
}

interface MockCommand extends CommandClient {
  readonly sent: { cmd: number; params: number[] }[];
}

/** CommandClient whose `send` records calls; other verbs are inert. */
function makeCommand(): MockCommand {
  const sent: { cmd: number; params: number[] }[] = [];
  const send = vi.fn<CommandClient['send']>((cmd: number, params: number[]) => {
    sent.push({ cmd, params: [...params] });
    return Promise.resolve({ result: 0 });
  });
  return {
    sent,
    send,
    arm: (): Promise<void> => Promise.resolve(),
    setMode: (): Promise<void> => Promise.resolve(),
    takeoff: (): Promise<void> => Promise.resolve(),
    land: (): Promise<void> => Promise.resolve(),
    rtl: (): Promise<void> => Promise.resolve(),
    guidedGoto: (): Promise<void> => Promise.resolve(),
    setRoi: (): Promise<void> => Promise.resolve(),
    clearRoi: (): Promise<void> => Promise.resolve(),
    setCurrentWp: (): Promise<void> => Promise.resolve(),
  };
}

function makeConfirm(answer: boolean): {
  fn: (opts: ConfirmOptions) => Promise<boolean>;
  calls: ConfirmOptions[];
} {
  const calls: ConfirmOptions[] = [];
  const fn = vi.fn<(opts: ConfirmOptions) => Promise<boolean>>((opts: ConfirmOptions) => {
    calls.push(opts);
    return Promise.resolve(answer);
  });
  return { fn, calls };
}

interface Harness {
  container: HTMLElement;
  param: MockParam;
  command: MockCommand;
  confirm: ReturnType<typeof makeConfirm>;
  store: ReturnType<typeof createAppStore>;
}

function mountScreen(opts?: { confirmAnswer?: boolean }): Harness {
  const param = makeParam();
  const command = makeCommand();
  const confirm = makeConfirm(opts?.confirmAnswer ?? true);
  const store = createAppStore();
  const { container } = render(() =>
    createComponent(SetupScreen, {
      calibration: stubCalibration(),
      param,
      command,
      store,
      confirm: confirm.fn,
      t,
    }),
  );
  return { container, param, command, confirm, store };
}

const STEP_IDS = ['frame', 'accel', 'compass', 'radio', 'modes', 'failsafe', 'battery', 'motors'];

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

describe('SetupScreen — composition', () => {
  it('renders the wizard with all eight steps in order', async () => {
    const { container } = mountScreen();
    await settle();

    expect(container.querySelector('.mvp-setup-wizard')).toBeTruthy();
    const tabs = [...container.querySelectorAll<HTMLButtonElement>('.mvp-setup-wizard__steptab')];
    expect(tabs.map((b) => b.id)).toEqual(STEP_IDS.map((id) => `mvp-setup-tab-${id}`));
  });

  it('switching to a step mounts that step pane (only the active one)', async () => {
    const { container } = mountScreen();
    await settle();

    // Default active step is `frame`; the motors pane is not mounted yet.
    expect(container.querySelector('[data-testid="motors-ack"]')).toBeNull();

    const motorsTab = container.querySelector<HTMLButtonElement>('#mvp-setup-tab-motors');
    expect(motorsTab).not.toBeNull();
    motorsTab?.click();
    await settle();

    // The motors pane is now mounted (its props-ack gate is present).
    expect(container.querySelector('[data-testid="motors-ack"]')).not.toBeNull();
    expect(container.querySelector('#mvp-setup-panel-motors')).not.toBeNull();
  });
});

describe('SetupScreen — parameter fetch affordance', () => {
  it('loads the parameter set when Setup opens (default-active frame step)', async () => {
    const { param } = mountScreen();
    await settle();
    // The default-active frame step fetches the set on its own mount.
    expect(param.fetchAllSpy).toHaveBeenCalledTimes(1);
  });

  it('the Fetch button triggers an explicit parameter (re)load', async () => {
    const { container, param } = mountScreen();
    await settle();
    const initial = param.fetchAllSpy.mock.calls.length;

    const btn = container.querySelector<HTMLButtonElement>('[data-testid="setup-fetch"]');
    expect(btn).not.toBeNull();
    btn?.click();
    await settle();
    expect(param.fetchAllSpy.mock.calls.length).toBe(initial + 1);
  });
});

describe('SetupScreen — motor-test confirm gating', () => {
  it('routes a motor test through the destructive confirm gate', async () => {
    const { container, command, confirm } = mountScreen({ confirmAnswer: true });
    await settle();

    container.querySelector<HTMLButtonElement>('#mvp-setup-tab-motors')?.click();
    await settle();

    // Acknowledge props-removed; the per-motor test button then enables.
    const ack = container.querySelector<HTMLInputElement>('[data-testid="motors-ack"]');
    expect(ack).not.toBeNull();
    if (ack !== null) {
      ack.checked = true;
      ack.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await settle();

    container.querySelector<HTMLButtonElement>('[data-testid="motors-test-1"]')?.click();
    await settle();

    expect(confirm.calls.length).toBe(1);
    expect(confirm.calls[0]?.destructive).toBe(true);
    expect(confirm.calls[0]?.armedAware).toBe(true);
    expect(command.sent).toHaveLength(1);
  });

  it('sends nothing when the confirmation is declined', async () => {
    const { container, command, confirm } = mountScreen({ confirmAnswer: false });
    await settle();

    container.querySelector<HTMLButtonElement>('#mvp-setup-tab-motors')?.click();
    await settle();

    const ack = container.querySelector<HTMLInputElement>('[data-testid="motors-ack"]');
    if (ack !== null) {
      ack.checked = true;
      ack.dispatchEvent(new Event('change', { bubbles: true }));
    }
    await settle();

    container.querySelector<HTMLButtonElement>('[data-testid="motors-test-1"]')?.click();
    await settle();

    expect(confirm.calls.length).toBe(1);
    expect(command.sent).toHaveLength(0);
  });
});

// --------------------------------------------------------------------------
// Shell integration: navigating to Setup mounts the real screen
// --------------------------------------------------------------------------

function makeCaps(): Capabilities {
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
  };
}

describe('SetupScreen — shell registration', () => {
  it('replaces the Setup placeholder so the dock mounts the real screen', async () => {
    const store = createAppStore();
    const registry = createUiRegistry();
    const param = makeParam();
    const command = makeCommand();

    const dispose = setScreenPanel(
      'setup',
      createSetupScreenPanel({
        calibration: stubCalibration(),
        param,
        command,
        store,
        registry,
        t,
      }),
    );

    const ctx: ShellContextValue = {
      store,
      registry,
      capabilities: makeCaps(),
      panelApi: { store, t },
    };
    const { container } = render(() => createComponent(Shell, { ctx }));
    await settle();

    // Navigate to Setup; the real composed screen mounts over the placeholder.
    store.patch((s) => {
      s.layout.activeScreen = 'setup';
    });
    await settle();

    expect(container.querySelector('.mvp-setup-screen')).toBeTruthy();
    expect(container.querySelector('.mvp-setup-wizard')).toBeTruthy();
    expect(container.querySelector('.mvp-screen__hint')).toBeNull();

    dispose();
  });
});
