/**
 * App Settings → General / Advanced + About section tests (spec docs/appsettings
 * §3/§7). Renders {@link GeneralSection} over a fresh `createAppStore()` with a
 * fake {@link FileIo} (capturing the `saveAs` blob; returning a bundle from
 * `openForRead`), fake {@link StorageManagerDeps} and a confirm stub, and asserts
 * the audio/confirm checkboxes write `store.settings`, export emits a redacted
 * bundle (no `apiKey`) and import merges the parsed patch. Renders
 * {@link AboutSection} and asserts the app version text is shown.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { AppState, BlobMeta, BlobStore, FileIo, Store, UiRegistry } from '../../src/contracts';
import type { KeybindRegistry } from '../../src/core/keybinds';
import type { RecentsStore } from '../../src/core/recents';
import { createAppStore } from '../../src/core/store';
import { serializeSettings } from '../../src/core/settings-bundle';
import { APP_VERSION } from '../../src/version';
import type { StorageManagerDeps } from '../../src/ui/screens/config/settings/storage-manager';
import type { AppSettingsSectionDeps, ConfirmFn } from '../../src/ui/shell/appsettings/context';
import { GeneralSection } from '../../src/ui/shell/appsettings/sections/general';
import { AboutSection } from '../../src/ui/shell/appsettings/sections/about';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(cleanup);

/** In-memory {@link BlobStore} returning a fixed meta list. */
function fakeBlobs(rows: BlobMeta[]): BlobStore {
  return {
    put: () => Promise.resolve(),
    getRange: () => Promise.resolve(new Uint8Array()),
    size: () => Promise.resolve(0),
    list: () => Promise.resolve(rows),
    del: () => Promise.resolve(),
  };
}

/** Fake {@link StorageManagerDeps} with spy-able destructive handles. */
function fakeStorage(): StorageManagerDeps & {
  clearTileCache: ReturnType<typeof vi.fn>;
  clearAllData: ReturnType<typeof vi.fn>;
} {
  return {
    blobs: fakeBlobs([{ key: 't1', bytes: 2048 }]),
    estimate: () => Promise.resolve({ usage: 4096, quota: 1024 * 1024 }),
    clearTileCache: vi.fn(() => Promise.resolve()),
    clearAllData: vi.fn(() => Promise.resolve()),
    saveFile: () => Promise.resolve(),
  };
}

/** Fake {@link FileIo}: captures `saveAs` blobs; `openForRead` yields a bundle. */
function fakeFiles(importBundle: string): FileIo & { saved: { blob: Blob; name: string }[] } {
  const saved: { blob: Blob; name: string }[] = [];
  return {
    saved,
    openForRead: () =>
      Promise.resolve({
        name: 'settings.mvpsettings.json',
        blob: new Blob([importBundle], { type: 'application/json' }),
      }),
    saveAs: (data: Blob, name: string) => {
      saved.push({ blob: data, name });
      return Promise.resolve();
    },
  };
}

/** Assemble {@link AppSettingsSectionDeps}; only the fields used here are real. */
function makeDeps(
  store: Store<AppState>,
  files: FileIo,
  extra: Partial<AppSettingsSectionDeps> = {},
): AppSettingsSectionDeps {
  return {
    store,
    t: (key: string) => key,
    files,
    recents: {} as unknown as RecentsStore,
    keybinds: {} as unknown as KeybindRegistry,
    persistKeybinds: () => undefined,
    registry: {} as unknown as import('../../src/ui/shell/registry').ShellRegistry,
    setSection: () => undefined,
    close: () => undefined,
    ...extra,
  };
}

describe('GeneralSection — toggles', () => {
  it('writes audioAlerts + confirmDestructive via store.patch', async () => {
    const store = createAppStore();
    const deps = makeDeps(store, fakeFiles('{}'));
    const { getByTestId } = render(() => createComponent(GeneralSection, { deps }));

    expect(store.get().settings.audioAlerts).toBe(true);
    fireEvent.click(getByTestId('appsettings-general-audio'));
    await settle();
    expect(store.get().settings.audioAlerts).toBe(false);

    fireEvent.click(getByTestId('appsettings-general-confirm'));
    await settle();
    expect(store.get().settings.confirmDestructive).toBe(false);
  });

  it('sets a positive telemetry rate and deletes it when blanked', async () => {
    const store = createAppStore();
    const deps = makeDeps(store, fakeFiles('{}'));
    const { getByTestId } = render(() => createComponent(GeneralSection, { deps }));

    fireEvent.input(getByTestId('appsettings-general-telemetry'), { target: { value: '8' } });
    await settle();
    expect(store.get().settings.telemetryRateHz).toBe(8);

    fireEvent.input(getByTestId('appsettings-general-telemetry'), { target: { value: '' } });
    await settle();
    expect(store.get().settings.telemetryRateHz).toBeUndefined();
  });
});

describe('GeneralSection — settings backup', () => {
  it('exports a redacted bundle (no apiKey) via saveAs', async () => {
    const store = createAppStore();
    store.patch((d) => {
      d.settings.mapSource = {
        urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png',
        apiKey: 'secret-key',
      };
    });
    await settle();

    const files = fakeFiles('{}');
    const deps = makeDeps(store, files);
    const { getByTestId } = render(() => createComponent(GeneralSection, { deps }));

    fireEvent.click(getByTestId('appsettings-general-export'));
    await settle();

    expect(files.saved).toHaveLength(1);
    const entry = files.saved[0]!;
    expect(entry.name).toBe('settings.mvpsettings.json');
    expect(entry.blob.type).toBe('application/json');
    const text = await entry.blob.text();
    const parsed = JSON.parse(text) as {
      settings: { mapSource?: { urlTemplate?: string; apiKey?: string } };
    };
    expect(parsed.settings.mapSource?.urlTemplate).toBe('https://tiles.example/{z}/{x}/{y}.png');
    expect(parsed.settings.mapSource?.apiKey).toBeUndefined();
  });

  it('merges an imported bundle into store.settings', async () => {
    const store = createAppStore();
    const bundle = serializeSettings({
      units: 'imperial',
      coordinateFormat: 'mgrs',
      theme: 'field',
      language: 'en',
      audioAlerts: false,
      confirmDestructive: true,
    });
    const deps = makeDeps(store, fakeFiles(bundle));
    const { getByTestId } = render(() => createComponent(GeneralSection, { deps }));

    expect(store.get().settings.units).toBe('metric');
    fireEvent.click(getByTestId('appsettings-general-import'));
    await settle();
    await settle();

    expect(store.get().settings.units).toBe('imperial');
    expect(store.get().settings.coordinateFormat).toBe('mgrs');
    expect(store.get().settings.audioAlerts).toBe(false);
  });

  it('shows an import error for an invalid bundle', async () => {
    const store = createAppStore();
    const deps = makeDeps(store, fakeFiles('not a bundle'));
    const { getByTestId, queryByTestId } = render(() => createComponent(GeneralSection, { deps }));

    expect(queryByTestId('appsettings-general-import-error')).toBeNull();
    fireEvent.click(getByTestId('appsettings-general-import'));
    await settle();
    await settle();
    expect(getByTestId('appsettings-general-import-error')).toBeTruthy();
  });
});

describe('GeneralSection — storage actions', () => {
  it('runs the injected clear-tiles + confirmed factory-reset handles', async () => {
    const store = createAppStore();
    const storage = fakeStorage();
    const confirm: ConfirmFn = vi.fn(() => Promise.resolve(true));
    const deps = makeDeps(store, fakeFiles('{}'), { storage, confirm });
    const { getByTestId } = render(() => createComponent(GeneralSection, { deps }));

    const enabled = (id: string): Promise<void> =>
      vi.waitFor(() => expect((getByTestId(id) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(getByTestId('appsettings-general-clear-tiles'));
    await vi.waitFor(() => expect(storage.clearTileCache).toHaveBeenCalledTimes(1));
    await enabled('appsettings-general-factory-reset');

    fireEvent.click(getByTestId('appsettings-general-factory-reset'));
    await vi.waitFor(() => {
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(storage.clearAllData).toHaveBeenCalledTimes(1);
    });
  });
});

describe('AboutSection', () => {
  it('renders the About panel with the app version text', () => {
    const store = createAppStore();
    const deps = makeDeps(store, fakeFiles('{}'));
    const { container } = render(() => createComponent(AboutSection, { deps }));
    expect(container.textContent ?? '').toContain(`MVPlanner ${APP_VERSION}`);
  });
});
