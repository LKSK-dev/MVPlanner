/**
 * Storage Manager model for the App Settings pane (task T3.7; spec plan/07 §7.3).
 * Pure + DOM-free and fully dependency-injected so it unit-tests without
 * IndexedDB: it reports storage usage (via `navigator.storage.estimate` when
 * available) plus per-namespace blob sizes queried from the storage foundation's
 * {@link BlobStore}, and wraps the destructive/export actions (clear tile cache,
 * factory reset, export settings) behind injected handles.
 *
 * The concrete browser wiring (real `navigator.storage`, the storage
 * foundation, the tile cache and FileIo) is assembled by the app shell and
 * passed in as {@link StorageManagerDeps}; tests pass fakes.
 */
import type { AppSettings, BlobStore } from '../../../contracts';

/** The subset of `StorageEstimate` the manager surfaces. */
export interface StorageEstimateLike {
  /** Bytes currently used by the origin (if known). */
  usage?: number;
  /** Total bytes available to the origin (if known). */
  quota?: number;
}

/** Aggregate blob usage for one namespace. */
export interface NamespaceUsage {
  /** The blob namespace (logical bucket, e.g. `tiles`). */
  ns: string;
  /** Total bytes stored across the namespace. */
  bytes: number;
  /** Number of stored items in the namespace. */
  count: number;
}

/** A point-in-time storage report rendered by the manager. */
export interface StorageReport {
  /** Origin-level estimate, or `undefined` when the API is unavailable. */
  estimate?: StorageEstimateLike;
  /** Per-namespace blob usage rows (queryable categories). */
  namespaces: NamespaceUsage[];
}

/** Injected handles backing the Storage Manager (spec plan/07 §7.3). */
export interface StorageManagerDeps {
  /** Blob store for per-namespace size queries (the foundation's `blobs`). */
  readonly blobs: BlobStore;
  /** Blob namespaces to report; defaults to {@link DEFAULT_BLOB_NAMESPACES}. */
  readonly blobNamespaces?: readonly string[];
  /**
   * Origin-level usage estimate. Omit when `navigator.storage.estimate` is
   * unavailable; {@link browserStorageEstimate} builds the default wrapper.
   */
  readonly estimate?: () => Promise<StorageEstimateLike>;
  /** Clear the cached map tiles (e.g. `tileCache.clear()`). */
  readonly clearTileCache: () => Promise<void>;
  /** Factory reset: wipe all locally stored data + caches (spec plan/07 §7.7). */
  readonly clearAllData: () => Promise<void>;
  /** Persist an export blob to disk (FileIo `saveAs` or a download fallback). */
  readonly saveFile: (data: Blob, suggestedName: string) => Promise<void>;
}

/** Blob namespaces reported by default (currently the map tile cache). */
export const DEFAULT_BLOB_NAMESPACES: readonly string[] = ['tiles'];

/** Suggested filename for an exported settings bundle. */
export const SETTINGS_EXPORT_FILENAME = 'mvplanner-settings.json';

/**
 * Minimal structural view of `navigator.storage` for the usage estimate, so the
 * wrapper builder stays testable without the DOM lib's full `StorageManager`.
 */
interface StorageEstimatorLike {
  readonly estimate?: () => Promise<StorageEstimateLike>;
}
interface NavigatorWithStorage {
  readonly storage?: StorageEstimatorLike;
}

/**
 * Build the default origin-usage estimator from the ambient `navigator`, or
 * `undefined` when `navigator.storage.estimate` is unavailable (so the manager
 * can render an "estimate unavailable" state instead of throwing).
 *
 * @param nav - Optional navigator override (injected in tests).
 */
export function browserStorageEstimate(
  nav?: NavigatorWithStorage,
): (() => Promise<StorageEstimateLike>) | undefined {
  const navigatorLike = nav ?? (globalThis as { navigator?: NavigatorWithStorage }).navigator;
  const storage = navigatorLike?.storage;
  if (!storage || typeof storage.estimate !== 'function') return undefined;
  const estimate = storage.estimate.bind(storage);
  return async (): Promise<StorageEstimateLike> => {
    const result = await estimate();
    const out: StorageEstimateLike = {};
    if (typeof result.usage === 'number') out.usage = result.usage;
    if (typeof result.quota === 'number') out.quota = result.quota;
    return out;
  };
}

/**
 * Load a {@link StorageReport}: the origin estimate (when available) plus a
 * per-namespace blob-usage breakdown. Never throws on a missing namespace —
 * `BlobStore.list` returns `[]` for an empty/absent bucket.
 */
export async function loadStorageReport(deps: StorageManagerDeps): Promise<StorageReport> {
  const namespaces = deps.blobNamespaces ?? DEFAULT_BLOB_NAMESPACES;
  const rows = await Promise.all(
    namespaces.map(async (ns): Promise<NamespaceUsage> => {
      const metas = await deps.blobs.list(ns);
      const bytes = metas.reduce((sum, m) => sum + m.bytes, 0);
      return { ns, bytes, count: metas.length };
    }),
  );
  const report: StorageReport = { namespaces: rows };
  if (deps.estimate) {
    report.estimate = await deps.estimate();
  }
  return report;
}

/**
 * Serialize {@link AppSettings} to a pretty-printed JSON export bundle. By
 * default the map-provider `apiKey` is **redacted** (spec plan/07 §7.7: export
 * bundles may redact secrets); pass `redactSecrets: false` to include it.
 */
export function serializeSettings(
  settings: AppSettings,
  opts?: { redactSecrets?: boolean },
): string {
  const redact = opts?.redactSecrets ?? true;
  let exported: AppSettings = settings;
  if (redact && settings.mapSource?.apiKey !== undefined) {
    exported = {
      ...settings,
      mapSource: { urlTemplate: settings.mapSource.urlTemplate },
    };
  }
  return JSON.stringify({ kind: 'mvplanner.settings', version: 1, settings: exported }, null, 2);
}

/**
 * Export the current settings to disk as a JSON bundle via the injected
 * `saveFile` handle. Secrets are redacted by default (see
 * {@link serializeSettings}).
 */
export async function exportSettings(
  deps: Pick<StorageManagerDeps, 'saveFile'>,
  settings: AppSettings,
  opts?: { redactSecrets?: boolean },
): Promise<void> {
  const json = serializeSettings(settings, opts);
  const blob = new Blob([json], { type: 'application/json' });
  await deps.saveFile(blob, SETTINGS_EXPORT_FILENAME);
}
