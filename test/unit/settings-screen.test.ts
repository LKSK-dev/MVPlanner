/**
 * App Settings screen tests (task T3.7; spec plan/04 §4.5, plan/05 §5.4
 * Settings, plan/07 §7.3). Renders {@link SettingsScreen} over a fresh
 * `createAppStore()` and asserts each control patches `store.settings`, the live
 * preview reflects the unit/coordinate choice, and the Storage Manager lists
 * usage + routes the clear/export actions through the injected handles.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { BlobMeta, BlobStore } from '../../src/contracts';
import { createAppStore } from '../../src/core/store';
import { SettingsScreen, type StorageManagerDeps } from '../../src/ui/screens/config/settings';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(cleanup);

function fakeBlobs(rows: BlobMeta[]): BlobStore {
  return {
    put: () => Promise.resolve(),
    getRange: () => Promise.resolve(new Uint8Array()),
    size: () => Promise.resolve(0),
    list: () => Promise.resolve(rows),
    del: () => Promise.resolve(),
  };
}

function mockStorageDeps(): StorageManagerDeps & {
  clearTileCache: ReturnType<typeof vi.fn>;
  clearAllData: ReturnType<typeof vi.fn>;
  saveFile: ReturnType<typeof vi.fn>;
} {
  return {
    blobs: fakeBlobs([{ key: 't1', bytes: 2048 }]),
    estimate: () => Promise.resolve({ usage: 4096, quota: 1024 * 1024 }),
    clearTileCache: vi.fn(() => Promise.resolve()),
    clearAllData: vi.fn(() => Promise.resolve()),
    saveFile: vi.fn(() => Promise.resolve()),
  };
}

describe('SettingsScreen — editing store.settings', () => {
  it('patches each setting via store.patch', async () => {
    const store = createAppStore();
    const { getByTestId } = render(() => createComponent(SettingsScreen, { store }));

    fireEvent.change(getByTestId('settings-units'), { target: { value: 'imperial' } });
    await settle();
    expect(store.get().settings.units).toBe('imperial');

    fireEvent.change(getByTestId('settings-coord'), { target: { value: 'mgrs' } });
    await settle();
    expect(store.get().settings.coordinateFormat).toBe('mgrs');

    fireEvent.change(getByTestId('settings-theme'), { target: { value: 'light' } });
    await settle();
    expect(store.get().settings.theme).toBe('light');

    fireEvent.click(getByTestId('settings-audio'));
    await settle();
    expect(store.get().settings.audioAlerts).toBe(false);

    fireEvent.click(getByTestId('settings-confirm'));
    await settle();
    expect(store.get().settings.confirmDestructive).toBe(false);
  });

  it('writes the optional map source + telemetry rate fields', async () => {
    const store = createAppStore();
    const { getByTestId } = render(() => createComponent(SettingsScreen, { store }));

    fireEvent.input(getByTestId('settings-map-url'), {
      target: { value: 'https://tiles.example/{z}/{x}/{y}.png' },
    });
    fireEvent.input(getByTestId('settings-map-key'), { target: { value: 'k-123' } });
    fireEvent.input(getByTestId('settings-telemetry-rate'), { target: { value: '8' } });
    await settle();

    expect(store.get().settings.mapSource).toEqual({
      urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png',
      apiKey: 'k-123',
    });
    expect(store.get().settings.telemetryRateHz).toBe(8);

    // clearing the rate field removes the optional field again
    fireEvent.input(getByTestId('settings-telemetry-rate'), { target: { value: '' } });
    await settle();
    expect(store.get().settings.telemetryRateHz).toBeUndefined();
  });

  it('live preview reflects the chosen unit + coordinate format', async () => {
    const store = createAppStore();
    const { getByTestId } = render(() => createComponent(SettingsScreen, { store }));

    const altitude = getByTestId('settings-preview-altitude');
    const coord = getByTestId('settings-preview-coord');
    const metricAlt = altitude.textContent ?? '';
    const ddCoord = coord.textContent ?? '';
    expect(metricAlt).toMatch(/\bm$/); // metres

    fireEvent.change(getByTestId('settings-units'), { target: { value: 'imperial' } });
    await settle();
    expect(altitude.textContent ?? '').toMatch(/\bft$/); // feet

    fireEvent.change(getByTestId('settings-coord'), { target: { value: 'dms' } });
    await settle();
    expect(coord.textContent ?? '').not.toBe(ddCoord);
    expect(coord.textContent ?? '').toContain('″'); // DMS seconds symbol
  });
});

describe('SettingsScreen — Storage Manager', () => {
  it('lists usage + per-namespace sizes and runs the injected actions', async () => {
    const store = createAppStore();
    const storage = mockStorageDeps();
    const confirm = vi.fn(() => Promise.resolve(true));
    const { getByTestId } = render(() =>
      createComponent(SettingsScreen, { store, storage, confirm }),
    );

    // onMount loads the report.
    await vi.waitFor(() => {
      expect(getByTestId('settings-storage-usage').textContent ?? '').toContain('4.0 KiB');
    });
    expect(getByTestId('settings-storage-namespaces').textContent ?? '').toContain('tiles');

    // Each action sets a `busy` lock until its follow-up report refresh settles;
    // wait for the controls to re-enable before issuing the next one.
    const enabled = (id: string): Promise<void> =>
      vi.waitFor(() => expect((getByTestId(id) as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(getByTestId('settings-clear-tiles'));
    await vi.waitFor(() => expect(storage.clearTileCache).toHaveBeenCalledTimes(1));
    await enabled('settings-export');

    fireEvent.click(getByTestId('settings-export'));
    await vi.waitFor(() => expect(storage.saveFile).toHaveBeenCalledTimes(1));
    await enabled('settings-clear-all');

    fireEvent.click(getByTestId('settings-clear-all'));
    await vi.waitFor(() => {
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(storage.clearAllData).toHaveBeenCalledTimes(1);
    });
  });

  it('does not clear all data when the confirm is declined', async () => {
    const store = createAppStore();
    const storage = mockStorageDeps();
    const confirm = vi.fn(() => Promise.resolve(false));
    const { getByTestId } = render(() =>
      createComponent(SettingsScreen, { store, storage, confirm }),
    );

    fireEvent.click(getByTestId('settings-clear-all'));
    await vi.waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    await settle();
    expect(storage.clearAllData).not.toHaveBeenCalled();
  });

  it('renders a disabled state when no storage deps are injected', () => {
    const store = createAppStore();
    const { getByTestId } = render(() => createComponent(SettingsScreen, { store }));
    expect(getByTestId('settings-storage-unavailable')).toBeTruthy();
  });
});
