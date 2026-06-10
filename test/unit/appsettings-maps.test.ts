/**
 * App Settings → Maps section tests (spec docs/appsettings §5.6/§7.4). Renders
 * {@link MapsSection} over a fresh `createAppStore()` and asserts the preset
 * picker writes the matching URL into `settings.mapSource`, the custom fields
 * persist a user-supplied URL, and the tile-cache button routes through the
 * injected Storage Manager.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { BlobMeta, BlobStore } from '../../src/contracts';
import { createAppStore } from '../../src/core/store';
import { MapsSection } from '../../src/ui/shell/appsettings/sections/maps';
import type { AppSettingsSectionDeps } from '../../src/ui/shell/appsettings/context';
import type { StorageManagerDeps } from '../../src/ui/shell/appsettings/storage-manager';
import { settle } from '../helpers';

afterEach(cleanup);

const OSM_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** A minimal deps object backed by a real store + the i18n `t`. */
function makeDeps(
  store: ReturnType<typeof createAppStore>,
  storage?: StorageManagerDeps,
): AppSettingsSectionDeps {
  const base = {
    store,
    t: (key: string) => key,
    files: {} as AppSettingsSectionDeps['files'],
    recents: {} as AppSettingsSectionDeps['recents'],
    keybinds: {} as AppSettingsSectionDeps['keybinds'],
    persistKeybinds: () => {},
    registry: {} as AppSettingsSectionDeps['registry'],
    setSection: () => {},
    close: () => {},
  } satisfies Omit<AppSettingsSectionDeps, 'storage'>;
  return storage === undefined ? base : { ...base, storage };
}

function fakeBlobs(rows: BlobMeta[]): BlobStore {
  return {
    put: () => Promise.resolve(),
    getRange: () => Promise.resolve(new Uint8Array()),
    size: () => Promise.resolve(0),
    list: () => Promise.resolve(rows),
    del: () => Promise.resolve(),
  };
}

function mockStorage(): StorageManagerDeps & { clearTileCache: ReturnType<typeof vi.fn> } {
  return {
    blobs: fakeBlobs([{ key: 't1', bytes: 2048 }]),
    estimate: () => Promise.resolve({ usage: 4096, quota: 1024 * 1024 }),
    clearTileCache: vi.fn(() => Promise.resolve()),
    clearAllData: vi.fn(() => Promise.resolve()),
    saveFile: vi.fn(() => Promise.resolve()),
  };
}

describe('MapsSection — basemap preset', () => {
  it('writes the matching URL when a built-in preset is selected', async () => {
    const store = createAppStore();
    const { getByTestId } = render(() => createComponent(MapsSection, { deps: makeDeps(store) }));

    fireEvent.change(getByTestId('appsettings-maps-preset'), { target: { value: 'osm' } });
    await settle();

    expect(store.get().settings.mapSource).toEqual({ urlTemplate: OSM_URL });
  });

  it('clears a custom api key when switching to a built-in preset', async () => {
    const store = createAppStore();
    store.patch((d) => {
      d.settings.mapSource = { urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png', apiKey: 'k' };
    });
    await settle();
    const { getByTestId } = render(() => createComponent(MapsSection, { deps: makeDeps(store) }));

    fireEvent.change(getByTestId('appsettings-maps-preset'), { target: { value: 'osm' } });
    await settle();

    expect(store.get().settings.mapSource).toEqual({ urlTemplate: OSM_URL });
  });
});

describe('MapsSection — custom source', () => {
  it('persists a typed custom URL', async () => {
    const store = createAppStore();
    const { getByTestId } = render(() => createComponent(MapsSection, { deps: makeDeps(store) }));

    fireEvent.change(getByTestId('appsettings-maps-preset'), {
      target: { value: 'custom' },
    });
    await settle();

    fireEvent.input(getByTestId('appsettings-maps-url'), {
      target: { value: 'https://tiles.example/{z}/{x}/{y}.png' },
    });
    fireEvent.input(getByTestId('appsettings-maps-key'), { target: { value: 'k-123' } });
    await settle();

    expect(store.get().settings.mapSource).toEqual({
      urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png',
      apiKey: 'k-123',
    });
  });

  it('deletes mapSource once both custom fields are empty', async () => {
    const store = createAppStore();
    store.patch((d) => {
      d.settings.mapSource = { urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png' };
    });
    await settle();
    const { getByTestId } = render(() => createComponent(MapsSection, { deps: makeDeps(store) }));

    fireEvent.input(getByTestId('appsettings-maps-url'), { target: { value: '' } });
    await settle();

    expect(store.get().settings.mapSource).toBeUndefined();
  });
});

describe('MapsSection — tile cache', () => {
  it('clears the tile cache through the injected Storage Manager', async () => {
    const store = createAppStore();
    const storage = mockStorage();
    const { getByTestId } = render(() =>
      createComponent(MapsSection, { deps: makeDeps(store, storage) }),
    );

    fireEvent.click(getByTestId('appsettings-maps-clear-cache'));
    await vi.waitFor(() => expect(storage.clearTileCache).toHaveBeenCalledTimes(1));
  });

  it('omits the tile-cache group when no Storage Manager is injected', () => {
    const store = createAppStore();
    const { queryByTestId } = render(() => createComponent(MapsSection, { deps: makeDeps(store) }));
    expect(queryByTestId('appsettings-maps-clear-cache')).toBeNull();
  });
});
