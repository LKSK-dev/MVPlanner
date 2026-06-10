/**
 * M7 assembly gate evidence (spec plan/06; WBS M7 gate).
 *
 * Exercises the wired extension system end-to-end over mock-ish ports:
 *  - installing + enabling an example registers its panel + command, gated by
 *    the real install-prompt grant flow;
 *  - a deliberately-throwing extension is isolated (status `error`) and the app
 *    survives;
 *  - the scripting console runs a trivial script and returns a value through the
 *    context assembled over the system broker;
 *  - navigating to the Sim screen mounts the dev hub with the manager, console
 *    and API reference panels.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type {
  AppState,
  CommandClient,
  ConnState,
  DecodedMessage,
  FileIo,
  KvStore,
  MissionClient,
  ParamClient,
  Store,
} from '../../src/contracts';
import type { Capabilities } from '../../src/core/capabilities';
import { createAppStore } from '../../src/core/store';
import {
  Shell,
  createUiRegistry,
  setScreenPanel,
  type ShellContextValue,
  type ShellRegistry,
} from '../../src/ui/shell';
import {
  assembleExtContext,
  createEventsBus,
  createExtensionSystem,
  type EventsBus,
  type ExtApiServices,
  type ExtensionSystem,
} from '../../src/ext/api';
import { DisposeRegistry, type ExtModule } from '../../src/ext/host';
import { SCRIPTING_EXT_ID } from '../../src/ext/scripting';
import { createConsoleController } from '../../src/ui/widgets/console';
import {
  InstallPromptHost,
  createExtServices,
  createExtensionsController,
  createInstallPromptController,
  createSimDevTools,
  type ExtHost,
} from '../../src/ui/screens/sim';

import { fakeFiles, settle } from '../helpers';

function memKv(): KvStore {
  const m = new Map<string, unknown>();
  const key = (ns: string, k: string): string => `${ns}::${k}`;
  return {
    get: <T>(ns: string, k: string): Promise<T | undefined> =>
      Promise.resolve(m.get(key(ns, k)) as T | undefined),
    set: <T>(ns: string, k: string, v: T): Promise<void> => {
      m.set(key(ns, k), v);
      return Promise.resolve();
    },
    del: (ns: string, k: string): Promise<void> => {
      m.delete(key(ns, k));
      return Promise.resolve();
    },
  };
}

function fakeHost(): ExtHost {
  const noop = (): void => undefined;
  return {
    sendMessage: () => undefined,
    onMessage: (_names: readonly string[], _cb: (m: DecodedMessage) => void) => noop,
    onState: (_cb: (s: ConnState) => void) => noop,
    onTelemetry: (_cb: (s: unknown) => void) => noop,
    subscribeInspector: () => noop,
  };
}

function mockCommand(): CommandClient {
  const ok = (): Promise<void> => Promise.resolve();
  return {
    send: () => Promise.resolve({ result: 0 }),
    arm: ok,
    setMode: ok,
    takeoff: ok,
    land: ok,
    rtl: ok,
    guidedGoto: ok,
    setRoi: ok,
    clearRoi: ok,
    setCurrentWp: ok,
  };
}

function mockParams(): ParamClient {
  return {
    fetchAll: () => Promise.resolve([]),
    get: () => undefined,
    set: () => Promise.resolve(),
    onChange: () => () => undefined,
  };
}

function mockMission(): MissionClient {
  return {
    download: () => Promise.resolve({ type: 'mission', items: [] }),
    upload: () => Promise.resolve(),
    clear: () => Promise.resolve(),
    setCurrent: () => Promise.resolve(),
    onCurrent: () => () => undefined,
    onReached: () => () => undefined,
  };
}

function makeCaps(): Capabilities {
  return {
    webSerial: false,
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

interface Harness {
  store: Store<AppState>;
  registry: ShellRegistry;
  kv: KvStore;
  files: FileIo;
  events: EventsBus;
  services: ExtApiServices;
  system: ExtensionSystem;
  disposeServices: () => void;
}

function harness(): Harness {
  const store = createAppStore();
  const registry = createUiRegistry();
  const kv = memKv();
  const files = fakeFiles();
  const events = createEventsBus();
  const ext = createExtServices({
    host: fakeHost(),
    store,
    command: mockCommand(),
    params: mockParams(),
    mission: mockMission(),
    registry,
    files,
  });
  const system = createExtensionSystem({
    storage: kv,
    services: ext.services,
    confirm: () => Promise.resolve(true),
    events,
  });
  return {
    store,
    registry,
    kv,
    files,
    events,
    services: ext.services,
    system,
    disposeServices: ext.dispose,
  };
}

/** An example that registers a panel + a command when activated. */
const panelExample: ExtModule = {
  manifest: {
    id: 'test.panel',
    name: 'Test Panel',
    version: '1.0.0',
    apiVersion: '^1.0',
    permissions: ['ui:panel', 'telemetry:read'],
    contributes: {
      panels: [{ id: 'test-panel', title: 'Test' }],
      commands: [{ id: 'test.cmd', title: 'Test Command' }],
    },
  },
  activate(ctx) {
    ctx.ui?.registerPanel({
      id: 'test-panel',
      title: 'Test',
      mount: () => () => undefined,
    });
    ctx.ui?.registerCommand({ id: 'test.cmd', title: 'Test Command', run: () => undefined });
  },
};

/** An example whose activation throws (fault isolation evidence). */
const boomExample: ExtModule = {
  manifest: {
    id: 'test.boom',
    name: 'Boom',
    version: '1.0.0',
    apiVersion: '^1.0',
    permissions: [],
  },
  activate() {
    throw new Error('intentional activation failure');
  },
};

afterEach(() => {
  cleanup();
  setScreenPanel('sim', undefined);
});

describe('M7 — extension install + activate + permission prompt', () => {
  it('enables an example through the prompt flow and registers its panel + command', async () => {
    const h = harness();
    const promptCtl = createInstallPromptController();
    const manager = createExtensionsController({
      system: h.system,
      prompt: promptCtl.prompt,
      files: h.files,
      notify: { info: () => undefined, warn: () => undefined, error: () => undefined },
      t,
      examples: [panelExample],
    });

    render(() => createComponent(InstallPromptHost, { controller: promptCtl, t }));
    await manager.init();
    await settle();

    expect(manager.states().map((s) => s.id)).toContain('test.panel');

    const enabling = manager.enable('test.panel');
    await settle();

    const approve = document.querySelector<HTMLButtonElement>(
      '[data-testid="install-prompt-approve"]',
    );
    expect(approve).toBeTruthy();
    approve?.click();
    await enabling;

    expect(h.system.host.get('test.panel')?.status).toBe('active');
    expect(await h.system.grants.list('test.panel')).toEqual(
      expect.arrayContaining(['ui:panel', 'telemetry:read']),
    );
    expect(h.registry.getPanel('test-panel')).toBeTruthy();
    expect(h.registry.commands().some((c) => c.id === 'test.cmd')).toBe(true);

    h.disposeServices();
  });

  it('denying the prompt grants nothing (panel stays unregistered)', async () => {
    const h = harness();
    const promptCtl = createInstallPromptController();
    const manager = createExtensionsController({
      system: h.system,
      prompt: promptCtl.prompt,
      files: h.files,
      notify: { info: () => undefined, warn: () => undefined, error: () => undefined },
      t,
      examples: [panelExample],
    });

    render(() => createComponent(InstallPromptHost, { controller: promptCtl, t }));
    await manager.init();
    await settle();

    const enabling = manager.enable('test.panel');
    await settle();
    const deny = document.querySelector<HTMLButtonElement>('.mvp-extprompt__deny');
    deny?.click();
    await enabling;

    expect(await h.system.grants.list('test.panel')).toEqual([]);
    // No ui:panel grant ⇒ ctx.ui is absent ⇒ the panel never registers.
    expect(h.registry.getPanel('test-panel')).toBeUndefined();

    h.disposeServices();
  });
});

describe('M7 — fault isolation', () => {
  it('isolates a throwing extension as error (paused) and the app survives', async () => {
    const h = harness();
    const promptCtl = createInstallPromptController();
    const manager = createExtensionsController({
      system: h.system,
      prompt: promptCtl.prompt,
      files: h.files,
      notify: { info: () => undefined, warn: () => undefined, error: () => undefined },
      t,
      examples: [boomExample],
    });

    await manager.init();
    await manager.enable('test.boom');

    expect(h.system.host.get('test.boom')?.status).toBe('error');
    expect(manager.states().find((s) => s.id === 'test.boom')?.error).toContain(
      'intentional activation failure',
    );
    // App surface still works after the fault.
    expect(() => h.registry.toast('info', 'still alive')).not.toThrow();

    h.disposeServices();
  });
});

describe('M7 — scripting console', () => {
  it('runs a trivial script and returns its value', async () => {
    const h = harness();
    const scope = new DisposeRegistry();
    const controller = createConsoleController({
      makeContext: (grants) =>
        assembleExtContext({
          extId: SCRIPTING_EXT_ID,
          granted: new Set(grants),
          broker: h.system.broker,
          services: h.services,
          dispose: scope,
          version: '1.0.0',
          events: h.events,
        }),
      storage: h.kv,
      registry: h.registry,
    });

    const result = await controller.run('return 6 * 7');
    expect(result.ok).toBe(true);
    expect(result.value).toBe(42);

    scope.dispose();
    h.disposeServices();
  });
});

describe('M7 — Sim dev hub assembly', () => {
  it('mounts the dev hub (manager + console + API reference) over the sim placeholder', async () => {
    const h = harness();
    const promptCtl = createInstallPromptController();
    const tools = createSimDevTools({
      system: h.system,
      services: h.services,
      events: h.events,
      prompt: promptCtl.prompt,
      files: h.files,
      storage: h.kv,
      registry: h.registry,
      store: h.store,
      t,
      examples: [panelExample],
    });
    await tools.ready();

    const ctx: ShellContextValue = {
      store: h.store,
      registry: h.registry,
      capabilities: makeCaps(),
      panelApi: { store: h.store, t },
    };
    const { container } = render(() => createComponent(Shell, { ctx }));
    await settle();

    const simBtn = [...container.querySelectorAll<HTMLButtonElement>('.mvp-nav-item')].find(
      (b) => b.textContent === t('nav.sim'),
    );
    expect(simBtn).toBeTruthy();
    simBtn?.click();
    await settle();

    expect(h.store.get().layout.activeScreen).toBe('sim');
    expect(container.querySelector('.mvp-sim')).toBeTruthy();
    // All three tool panels mount into the hub (hidden hosts) on mount.
    expect(container.querySelector('.mvp-extmgr')).toBeTruthy();
    expect(container.querySelector('.mvp-console')).toBeTruthy();
    expect(container.querySelector('.mvp-api-ref')).toBeTruthy();
    // The example appears in the manager list.
    expect(container.querySelector('[data-ext="test.panel"]')).toBeTruthy();

    tools.dispose();
    h.disposeServices();
  });
});
