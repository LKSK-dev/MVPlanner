/**
 * App Settings — Storage Manager + contract-defaults tests (task T3.7; spec
 * plan/07 §7.3 Storage Manager, plan/07 §7.7 export redaction, plan/04 §4.5).
 *
 * Pure: no DOM. Exercises the injectable storage model (usage report,
 * serialize/redact, export) and asserts the T3.7 additive `AppSettings` fields
 * stay optional/unset in the default state so existing persistence holds.
 */
import { describe, it, expect, vi } from 'vitest';
import type { AppSettings, BlobMeta, BlobStore } from '../../src/contracts';
import { createDefaultAppState } from '../../src/core/store';
import {
  browserStorageEstimate,
  exportSettings,
  loadStorageReport,
  serializeSettings,
  type StorageManagerDeps,
} from '../../src/ui/shell/appsettings/storage-manager';

/** In-memory {@link BlobStore} backed by a per-namespace meta map. */
function fakeBlobs(data: Record<string, BlobMeta[]>): BlobStore {
  return {
    put: () => Promise.resolve(),
    getRange: () => Promise.resolve(new Uint8Array()),
    size: () => Promise.resolve(0),
    list: (ns: string): Promise<BlobMeta[]> => Promise.resolve(data[ns] ?? []),
    del: () => Promise.resolve(),
  };
}

const SETTINGS: AppSettings = {
  units: 'imperial',
  coordinateFormat: 'mgrs',
  theme: 'field',
  language: 'en',
  audioAlerts: false,
  confirmDestructive: true,
  mapSource: { urlTemplate: 'https://tiles.example/{z}/{x}/{y}.png', apiKey: 'secret-key' },
  telemetryRateHz: 10,
};

describe('createDefaultAppState — T3.7 additive fields', () => {
  it('leaves the new optional fields unset (inert by default)', () => {
    const settings = createDefaultAppState().settings;
    expect(settings.mapSource).toBeUndefined();
    expect(settings.telemetryRateHz).toBeUndefined();
    // existing required fields untouched
    expect(settings.units).toBe('metric');
    expect(settings.coordinateFormat).toBe('dd');
  });
});

describe('serializeSettings', () => {
  it('redacts the map apiKey by default (spec plan/07 §7.7)', () => {
    const parsed = JSON.parse(serializeSettings(SETTINGS)) as { settings: AppSettings };
    expect(parsed.settings.mapSource?.urlTemplate).toBe(SETTINGS.mapSource?.urlTemplate);
    expect(parsed.settings.mapSource?.apiKey).toBeUndefined();
    expect(parsed.settings.telemetryRateHz).toBe(10);
  });

  it('includes the apiKey when redaction is disabled', () => {
    const parsed = JSON.parse(serializeSettings(SETTINGS, { redactSecrets: false })) as {
      settings: AppSettings;
    };
    expect(parsed.settings.mapSource?.apiKey).toBe('secret-key');
  });

  it('does not mutate the source settings object', () => {
    serializeSettings(SETTINGS);
    expect(SETTINGS.mapSource?.apiKey).toBe('secret-key');
  });
});

describe('loadStorageReport', () => {
  it('sums per-namespace blob sizes and includes the origin estimate', async () => {
    const blobs = fakeBlobs({
      tiles: [
        { key: 'a', bytes: 100 },
        { key: 'b', bytes: 250 },
      ],
    });
    const deps: StorageManagerDeps = {
      blobs,
      estimate: () => Promise.resolve({ usage: 1234, quota: 9999 }),
      clearTileCache: () => Promise.resolve(),
      clearAllData: () => Promise.resolve(),
      saveFile: () => Promise.resolve(),
    };
    const report = await loadStorageReport(deps);
    expect(report.namespaces).toEqual([{ ns: 'tiles', bytes: 350, count: 2 }]);
    expect(report.estimate).toEqual({ usage: 1234, quota: 9999 });
  });

  it('omits the estimate when no estimator is injected; absent ns reports zero', async () => {
    const deps: StorageManagerDeps = {
      blobs: fakeBlobs({}),
      blobNamespaces: ['tiles', 'logs'],
      clearTileCache: () => Promise.resolve(),
      clearAllData: () => Promise.resolve(),
      saveFile: () => Promise.resolve(),
    };
    const report = await loadStorageReport(deps);
    expect(report.estimate).toBeUndefined();
    expect(report.namespaces).toEqual([
      { ns: 'tiles', bytes: 0, count: 0 },
      { ns: 'logs', bytes: 0, count: 0 },
    ]);
  });
});

describe('browserStorageEstimate', () => {
  it('returns undefined when navigator.storage.estimate is unavailable', () => {
    expect(browserStorageEstimate({})).toBeUndefined();
    expect(browserStorageEstimate({ storage: {} })).toBeUndefined();
  });

  it('wraps a present estimate(), projecting usage/quota', async () => {
    const nav = {
      storage: { estimate: () => Promise.resolve({ usage: 5, quota: 50, extra: 1 }) },
    };
    const wrapper = browserStorageEstimate(nav);
    expect(wrapper).toBeDefined();
    expect(await wrapper?.()).toEqual({ usage: 5, quota: 50 });
  });
});

describe('exportSettings', () => {
  it('saves a JSON blob via the injected saveFile', async () => {
    const saveFile = vi.fn((_blob: Blob, _name: string) => Promise.resolve());
    await exportSettings({ saveFile }, SETTINGS);
    expect(saveFile).toHaveBeenCalledTimes(1);
    const [blob, name] = saveFile.mock.calls[0]!;
    expect(name).toBe('mvplanner-settings.json');
    expect(blob.type).toBe('application/json');
    const text = await blob.text();
    expect(JSON.parse(text).settings.mapSource.apiKey).toBeUndefined();
  });
});
