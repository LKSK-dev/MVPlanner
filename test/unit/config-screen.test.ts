/**
 * Config screen assembly tests (M3 keystone; spec plan/04 §4.5, plan/05 §5.4
 * Config). Mounts {@link ConfigScreen} over mocks and asserts the three tabs
 * render + switch, the workbench Save/Compare route through a mock {@link FileIo},
 * and (shell integration) navigating to Config mounts the real screen over the
 * placeholder.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import type {
  AppState,
  BlobStore,
  CommandClient,
  FileIo,
  Param,
  ParamClient,
  Store,
} from '../../src/contracts';
import type { ParamMeta, ParamMetaResolver } from '../../src/ui/widgets/paramgrid';
import type { StorageManagerDeps } from '../../src/ui/screens/config/settings';
import { createAppStore } from '../../src/core/store';
import { MAV_PARAM_TYPE } from '../../src/mavlink/microservices/param';
import { ConfigScreen, createConfigScreenPanel } from '../../src/ui/screens/config';
import {
  Shell,
  createUiRegistry,
  setScreenPanel,
  type ShellContextValue,
} from '../../src/ui/shell';
import type { Capabilities } from '../../src/core/capabilities';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const REAL = MAV_PARAM_TYPE.REAL32;

function param(name: string, value: number): Param {
  return { name, value, type: REAL };
}

/** Mock ParamClient serving a small set + recording sets. */
function mockParamClient(data: readonly Param[]): ParamClient {
  return {
    fetchAll: (onProgress?: (d: number, n: number) => void): Promise<Param[]> => {
      data.forEach((_, i) => onProgress?.(i + 1, data.length));
      return Promise.resolve(data.map((p) => ({ ...p })));
    },
    get: (name) => data.find((p) => p.name === name),
    set: () => Promise.resolve(),
    onChange: () => () => undefined,
  };
}

const META: ParamMetaResolver = {
  get: (name): ParamMeta | undefined =>
    name === 'ATC_RAT_RLL_P' ? { min: 0, max: 0.35 } : undefined,
};

/** Mock FileIo recording saveAs + serving an openForRead payload. */
function mockFiles(): {
  files: FileIo;
  saveAs: ReturnType<typeof vi.fn>;
  openForRead: ReturnType<typeof vi.fn>;
} {
  const saveAs = vi.fn((_data: Blob, _name: string) => Promise.resolve());
  const text = 'ATC_RAT_RLL_P,0.5\n';
  const openForRead = vi.fn(
    (): Promise<{ name: string; blob: Blob }> =>
      Promise.resolve({
        name: 'copter.param',
        blob: new Blob([text], { type: 'text/plain' }),
      }),
  );
  const files: FileIo = {
    openForRead: openForRead as unknown as FileIo['openForRead'],
    saveAs,
  };
  return { files, saveAs, openForRead };
}

function fakeBlobs(): BlobStore {
  return {
    put: () => Promise.resolve(),
    getRange: () => Promise.resolve(new Uint8Array()),
    size: () => Promise.resolve(0),
    list: () => Promise.resolve([]),
    del: () => Promise.resolve(),
  };
}

function storageManager(): StorageManagerDeps {
  return {
    blobs: fakeBlobs(),
    clearTileCache: () => Promise.resolve(),
    clearAllData: () => Promise.resolve(),
    saveFile: () => Promise.resolve(),
  };
}

function mockCommand(): CommandClient {
  const reject = (): Promise<never> => Promise.reject(new Error('unused'));
  return {
    send: () => Promise.resolve({ result: 0 }),
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
}

interface MountOpts {
  store?: Store<AppState>;
  files?: FileIo;
  command?: CommandClient;
}

function mountScreen(opts: MountOpts = {}): HTMLElement {
  const store = opts.store ?? createAppStore();
  const { container } = render(() =>
    createComponent(ConfigScreen, {
      paramClient: mockParamClient([param('ATC_RAT_RLL_P', 0.135)]),
      meta: META,
      command: opts.command ?? mockCommand(),
      store,
      files: opts.files ?? mockFiles().files,
      storageManager: storageManager(),
      confirm: () => Promise.resolve(true),
      api: { store, t },
      t,
    }),
  );
  return container;
}

afterEach(() => {
  cleanup();
  setScreenPanel('config', undefined);
});

describe('ConfigScreen — tabs', () => {
  it('renders the Parameters + Tuning tabs and shows Parameters first', async () => {
    const container = mountScreen();
    await settle();

    const tabs = [...container.querySelectorAll<HTMLButtonElement>('.mvp-config__tab')];
    // Settings migrated to the App Settings pane (opened from the brand).
    expect(tabs.map((b) => b.textContent)).toEqual(['Parameters', 'Tuning']);

    // Parameters tab visible (its workbench mounted), Tuning hidden.
    expect(container.querySelector('.mvp-paramwb')).toBeTruthy();
    const tuningPanel = container.querySelector<HTMLElement>('[data-tabpanel="tuning"]')!;
    expect(tuningPanel.hidden).toBe(true);
    const paramsPanel = container.querySelector<HTMLElement>('[data-tabpanel="params"]')!;
    expect(paramsPanel.hidden).toBe(false);
  });

  it('switches to the Tuning tab on click', async () => {
    const container = mountScreen();
    await settle();

    const tuningTab = [...container.querySelectorAll<HTMLButtonElement>('.mvp-config__tab')].find(
      (b) => b.textContent === 'Tuning',
    )!;
    tuningTab.click();
    await settle();

    expect(tuningTab.getAttribute('aria-selected')).toBe('true');
    const tuningPanel = container.querySelector<HTMLElement>('[data-tabpanel="tuning"]')!;
    expect(tuningPanel.hidden).toBe(false);
    // The tuning panel content mounted (copter is the default class).
    expect(container.querySelector('.mvp-tuning')).toBeTruthy();
    const paramsPanel = container.querySelector<HTMLElement>('[data-tabpanel="params"]')!;
    expect(paramsPanel.hidden).toBe(true);
  });

  it('wires the workbench Save to the injected FileIo', async () => {
    const fio = mockFiles();
    const container = mountScreen({ files: fio.files });
    await settle();

    // Fetch so there is a set to save, then Save to file.
    const fetchBtn = [...container.querySelectorAll<HTMLButtonElement>('.mvp-paramwb__btn')].find(
      (b) => b.textContent === t('params.fetch'),
    )!;
    fetchBtn.click();
    await settle();
    await settle();

    const saveBtn = [...container.querySelectorAll<HTMLButtonElement>('.mvp-paramwb__btn')].find(
      (b) => b.textContent === t('params.save'),
    )!;
    saveBtn.click();
    await settle();
    await settle();

    expect(fio.saveAs).toHaveBeenCalledTimes(1);
  });

  it('wires the workbench Compare/Load to the injected FileIo', async () => {
    const fio = mockFiles();
    const container = mountScreen({ files: fio.files });
    await settle();

    const fetchBtn = [...container.querySelectorAll<HTMLButtonElement>('.mvp-paramwb__btn')].find(
      (b) => b.textContent === t('params.fetch'),
    )!;
    fetchBtn.click();
    await settle();
    await settle();

    const compareBtn = [...container.querySelectorAll<HTMLButtonElement>('.mvp-paramwb__btn')].find(
      (b) => b.textContent === t('params.compare'),
    )!;
    compareBtn.click();
    await settle();
    await settle();

    expect(fio.openForRead).toHaveBeenCalledTimes(1);
    // The diff drawer opened with the loaded comparison set.
    expect(container.querySelector('.mvp-paramwb__diff')).toBeTruthy();
  });
});

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

describe('ConfigScreen — shell registration', () => {
  it('replaces the Config placeholder so navigating mounts the real screen', async () => {
    const store = createAppStore();
    const registry = createUiRegistry();
    const fio = mockFiles();

    setScreenPanel(
      'config',
      createConfigScreenPanel({
        paramClient: mockParamClient([param('ATC_RAT_RLL_P', 0.135)]),
        meta: META,
        command: mockCommand(),
        store,
        storage: {
          kv: {
            get: () => Promise.resolve(undefined),
            set: () => Promise.resolve(),
            del: () => Promise.resolve(),
          },
          blobs: fakeBlobs(),
          files: fio.files,
          open: () => Promise.resolve({} as never),
          close: () => Promise.resolve(),
        },
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

    // Navigate to the Config screen.
    const configBtn = [...container.querySelectorAll<HTMLButtonElement>('.mvp-nav-item')].find(
      (b) => b.textContent === t('nav.config'),
    )!;
    configBtn.click();
    await settle();

    expect(store.get().layout.activeScreen).toBe('config');
    expect(container.querySelector('.mvp-config')).toBeTruthy();
    expect(container.querySelector('.mvp-config__tab')).toBeTruthy();
    expect(container.querySelector('.mvp-screen__hint')).toBeNull();
  });
});
