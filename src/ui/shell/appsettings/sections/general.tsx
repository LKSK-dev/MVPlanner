/**
 * App Settings → General / Advanced section (spec docs/appsettings §3/§7).
 *
 * Edits the app-wide toggles that don't belong to a more specific section —
 * voice/audio alerts, destructive-action confirmation and the default telemetry
 * rate — plus the storage manager (usage report + clear/factory-reset actions),
 * a portable settings backup (export/import the `.mvpsettings.json` bundle) and,
 * when injected, the Network egress-transparency panel.
 *
 * Every dependency arrives via {@link AppSettingsSectionDeps} so the section
 * unit-tests over a fresh `createAppStore()` with fakes: the storage handles,
 * the file picker and the safety-confirm seam are all injected. The audio /
 * confirm / telemetry writers and the busy/run storage pattern mirror the
 * legacy Settings screen (`ui/screens/config/settings/settings-screen.tsx`).
 */
import { Show, createMemo, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import { serializeSettings, parseSettingsBundle } from '../../../../core/settings-bundle';
import { formatBytes } from '../../../../core/units';
import {
  loadStorageReport,
  type StorageManagerDeps,
  type StorageReport,
} from '../../../screens/config/settings/storage-manager';
import { NetworkSection } from '../../../screens/config/settings/network';
import type { AppSettingsSectionDeps } from '../context';

/** Placeholder telemetry rate surfaced when the field is left blank. */
const DEFAULT_TELEMETRY_RATE_HZ = 4;

/** Delay before the post-factory-reset reload so the status line can paint. */
const RELOAD_DELAY_MS = 500;

/** Reload the app (no-op outside a browser/happy-dom environment). */
const reloadApp = (): void => {
  if (typeof location !== 'undefined') location.reload();
};

/** A human-readable message for an unknown thrown value. */
function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** The App Settings General / Advanced section. */
export const GeneralSection: Component<{ deps: AppSettingsSectionDeps }> = (props) => {
  const t = props.deps.t;
  const settings = props.deps.store.select((s) => s.settings);

  /** Patch a mutable draft of `settings` through the coalesced store write. */
  const patchSettings = (mutate: (draft: ReturnType<typeof settings>) => void): void => {
    props.deps.store.patch((d) => mutate(d.settings));
  };

  // --- telemetry rate writer (blank => delete; >0 => set) -------------------
  const setTelemetryRate = (raw: string): void => {
    const trimmed = raw.trim();
    if (trimmed === '') {
      patchSettings((s) => {
        delete s.telemetryRateHz;
      });
      return;
    }
    const value = Number.parseFloat(trimmed);
    if (!Number.isFinite(value) || value <= 0) return;
    patchSettings((s) => {
      s.telemetryRateHz = value;
    });
  };

  // --- storage manager (busy/run pattern mirrors the legacy screen) ---------
  const [report, setReport] = createSignal<StorageReport | undefined>(undefined);
  const [busy, setBusy] = createSignal(false);
  /** Inline failure line for storage/export/import actions (empty = none). */
  const [actionError, setActionError] = createSignal('');
  /** Post-factory-reset confirmation line (set just before the reload). */
  const [resetDone, setResetDone] = createSignal(false);

  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (reloadTimer !== undefined) clearTimeout(reloadTimer);
  });

  const refreshReport = async (): Promise<void> => {
    const deps = props.deps.storage;
    if (deps === undefined) return;
    setReport(await loadStorageReport(deps));
  };
  const run = (action: (deps: StorageManagerDeps) => Promise<void>): void => {
    const deps = props.deps.storage;
    if (deps === undefined || busy()) return;
    setBusy(true);
    setActionError('');
    void action(deps)
      .then(() => refreshReport())
      .catch((err: unknown) => {
        setActionError(t('appsettings.general.actionFailed', { message: errorMessage(err) }));
      })
      .finally(() => setBusy(false));
  };

  const onClearTiles = (): void => run((deps) => deps.clearTileCache());
  const onFactoryReset = (): void =>
    run(async (deps) => {
      const ok = await props.deps.confirm?.({
        title: t('appsettings.general.factoryReset.confirm.title'),
        body: t('appsettings.general.factoryReset.confirm.body'),
        destructive: true,
      });
      if (ok !== true) return; // fail CLOSED when the confirm seam is absent
      await deps.clearAllData();
      setResetDone(true);
      if (reloadTimer !== undefined) clearTimeout(reloadTimer);
      reloadTimer = setTimeout(reloadApp, RELOAD_DELAY_MS);
    });

  onMount(() => {
    void refreshReport();
  });

  const usageText = createMemo<string>(() => {
    const est = report()?.estimate;
    if (est?.usage === undefined || est.quota === undefined) {
      return t('appsettings.general.usage.unknown');
    }
    return t('appsettings.general.usage.value', {
      used: formatBytes(est.usage),
      quota: formatBytes(est.quota),
    });
  });

  // --- settings backup (export / import the portable bundle) ----------------
  const [importError, setImportError] = createSignal(false);
  /** Inline failure line for export/import I/O errors (empty = none). */
  const [bundleError, setBundleError] = createSignal('');

  const onExport = (): void => {
    setBundleError('');
    const json = serializeSettings(props.deps.store.get().settings);
    void props.deps.files
      .saveAs(new Blob([json], { type: 'application/json' }), 'settings.mvpsettings.json')
      .catch((err: unknown) => {
        setBundleError(t('appsettings.general.actionFailed', { message: errorMessage(err) }));
      });
  };
  const onImport = (): void => {
    setImportError(false);
    setBundleError('');
    void (async (): Promise<void> => {
      const picked = await props.deps.files.openForRead(['.json']);
      if (picked === undefined) return;
      const text = await picked.blob.text();
      const patch = parseSettingsBundle(text);
      if (patch === undefined) {
        setImportError(true);
        return;
      }
      props.deps.store.patch((d) => {
        Object.assign(d.settings, patch);
      });
    })().catch((err: unknown) => {
      setBundleError(t('appsettings.general.actionFailed', { message: errorMessage(err) }));
    });
  };

  return (
    <section class="mvp-appsettings__section" aria-label={t('appsettings.section.general')}>
      {/* Toggles ----------------------------------------------------------- */}
      <div class="mvp-appsettings__group">
        <label class="mvp-appsettings__field mvp-appsettings__field--row">
          <span class="mvp-appsettings__label">{t('appsettings.general.audio')}</span>
          <input
            type="checkbox"
            data-testid="appsettings-general-audio"
            checked={settings().audioAlerts}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              patchSettings((s) => {
                s.audioAlerts = checked;
              });
            }}
          />
        </label>

        <label class="mvp-appsettings__field mvp-appsettings__field--row">
          <span class="mvp-appsettings__label">{t('appsettings.general.confirm')}</span>
          <input
            type="checkbox"
            data-testid="appsettings-general-confirm"
            checked={settings().confirmDestructive}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              patchSettings((s) => {
                s.confirmDestructive = checked;
              });
            }}
          />
        </label>

        <label class="mvp-appsettings__field">
          <span class="mvp-appsettings__label">{t('appsettings.general.telemetry')}</span>
          <input
            type="number"
            min="0"
            step="1"
            class="mvp-appsettings__input"
            data-testid="appsettings-general-telemetry"
            placeholder={String(DEFAULT_TELEMETRY_RATE_HZ)}
            value={settings().telemetryRateHz ?? ''}
            onInput={(e) => setTelemetryRate(e.currentTarget.value)}
          />
          <span class="mvp-appsettings__hint">{t('appsettings.general.telemetry.hint')}</span>
        </label>
      </div>

      {/* Storage ----------------------------------------------------------- */}
      <Show when={props.deps.storage !== undefined}>
        <div class="mvp-appsettings__group">
          <h3>{t('appsettings.general.storage')}</h3>
          <p class="mvp-appsettings__field">
            <span class="mvp-appsettings__label">{t('appsettings.general.usage')}</span>{' '}
            <span data-testid="appsettings-general-usage">{usageText()}</span>
          </p>
          <div
            class="mvp-appsettings__actions"
            role="group"
            aria-label={t('appsettings.general.storage')}
          >
            <button
              type="button"
              class="mvp-appsettings__btn"
              data-testid="appsettings-general-refresh"
              disabled={busy()}
              onClick={() => void refreshReport()}
            >
              {t('appsettings.general.refresh')}
            </button>
            <button
              type="button"
              class="mvp-appsettings__btn"
              data-testid="appsettings-general-clear-tiles"
              disabled={busy()}
              onClick={onClearTiles}
            >
              {t('appsettings.general.clearTiles')}
            </button>
            <button
              type="button"
              class="mvp-appsettings__btn mvp-appsettings__btn--danger"
              data-testid="appsettings-general-factory-reset"
              disabled={busy()}
              onClick={onFactoryReset}
            >
              {t('appsettings.general.factoryReset')}
            </button>
          </div>
          <Show when={resetDone()}>
            <p class="mvp-appsettings__hint" data-testid="appsettings-general-reset-done">
              {t('appsettings.general.resetDone')}
            </p>
          </Show>
          <Show when={actionError() !== ''}>
            <p
              class="mvp-appsettings__hint"
              role="alert"
              data-testid="appsettings-general-action-error"
            >
              {actionError()}
            </p>
          </Show>
        </div>
      </Show>

      {/* Settings backup --------------------------------------------------- */}
      <div class="mvp-appsettings__group">
        <h3>{t('appsettings.general.bundle')}</h3>
        <div class="mvp-appsettings__actions">
          <button
            type="button"
            class="mvp-appsettings__btn"
            data-testid="appsettings-general-export"
            onClick={onExport}
          >
            {t('appsettings.general.exportSettings')}
          </button>
          <button
            type="button"
            class="mvp-appsettings__btn"
            data-testid="appsettings-general-import"
            onClick={onImport}
          >
            {t('appsettings.general.importSettings')}
          </button>
        </div>
        <Show when={importError()}>
          <p class="mvp-appsettings__hint" data-testid="appsettings-general-import-error">
            {t('appsettings.general.importError')}
          </p>
        </Show>
        <Show when={bundleError() !== ''}>
          <p
            class="mvp-appsettings__hint"
            role="alert"
            data-testid="appsettings-general-bundle-error"
          >
            {bundleError()}
          </p>
        </Show>
        <p class="mvp-appsettings__hint">{t('appsettings.general.persistenceNote')}</p>
      </div>

      {/* Network (egress transparency) ------------------------------------ */}
      <Show when={props.deps.network !== undefined}>
        <NetworkSection
          store={props.deps.store}
          deps={props.deps.network as NonNullable<AppSettingsSectionDeps['network']>}
          t={t}
        />
      </Show>
    </section>
  );
};
