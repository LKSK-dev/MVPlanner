/**
 * App Settings → Maps section (spec docs/appsettings §5.6/§7.4). Lets the user
 * pick a built-in basemap preset or a custom XYZ/WMS tile source (URL template
 * + optional provider API key), and — when the Storage Manager is wired —
 * inspect and clear the cached map tiles.
 *
 * The persisted shape is {@link AppState.settings.mapSource} (a
 * {@link MapSourceSetting}); {@link presetIdForSettings} maps it back to the
 * selected preset and {@link basemapFromSettings} (in the map widget) resolves
 * it to a concrete engine source. The map-source writers mirror the
 * (now-superseded) Settings screen: they preserve the sibling field and delete
 * `mapSource` entirely once both are empty. The section is store-/deps-injected,
 * so it unit-tests with a fresh `createAppStore()` and fakes.
 */
import { For, Show, createMemo, createSignal, onMount, type Component } from 'solid-js';
import type { AppState } from '../../../../contracts';
import { formatBytes } from '../../../../core/units';
import { BASEMAP_PRESETS, CUSTOM_PRESET_ID, presetIdForSettings } from '../../../widgets/map';
import { loadStorageReport, type StorageReport } from '../storage-manager';
import type { AppSettingsSectionDeps } from '../context';

/**
 * The Maps section: basemap preset picker, custom tile source fields, and the
 * tile-cache controls (when a Storage Manager is injected).
 */
export const MapsSection: Component<{ deps: AppSettingsSectionDeps }> = (props) => {
  const t = props.deps.t;
  const settings = props.deps.store.select((s) => s.settings);

  /** Patch a mutable draft of `settings` through the coalesced store write. */
  const patchSettings = (mutate: (draft: AppState['settings']) => void): void => {
    props.deps.store.patch((d) => {
      mutate(d.settings);
    });
  };

  // --- preset selection -----------------------------------------------------
  // `forceCustom` reveals the custom fields when the user picks "Custom…" before
  // a URL exists (an empty URL otherwise resolves to the default preset).
  const [forceCustom, setForceCustom] = createSignal(false);

  /** The preset id reflected by the select control. */
  const resolvedPresetId = createMemo<string>(() =>
    forceCustom() ? CUSTOM_PRESET_ID : presetIdForSettings(settings().mapSource),
  );

  /** Whether to show the custom URL/key fields. */
  const showCustom = createMemo<boolean>(() => resolvedPresetId() === CUSTOM_PRESET_ID);

  const onPresetChange = (id: string): void => {
    if (id === CUSTOM_PRESET_ID) {
      setForceCustom(true);
      return;
    }
    setForceCustom(false);
    const preset = BASEMAP_PRESETS.find((p) => p.id === id);
    const url = preset?.url;
    if (url === undefined) return;
    // Built-in preset: take its URL and clear any custom key.
    patchSettings((s) => {
      s.mapSource = { urlTemplate: url };
    });
  };

  // --- custom map-source writers (preserve the sibling field) ---------------
  const setMapUrl = (raw: string): void => {
    patchSettings((s) => {
      const apiKey = s.mapSource?.apiKey;
      if (raw === '' && (apiKey === undefined || apiKey === '')) {
        delete s.mapSource;
        return;
      }
      s.mapSource =
        apiKey !== undefined && apiKey !== '' ? { urlTemplate: raw, apiKey } : { urlTemplate: raw };
    });
  };
  const setMapKey = (raw: string): void => {
    patchSettings((s) => {
      const urlTemplate = s.mapSource?.urlTemplate ?? '';
      if (raw === '' && urlTemplate === '') {
        delete s.mapSource;
        return;
      }
      s.mapSource = raw !== '' ? { urlTemplate, apiKey: raw } : { urlTemplate };
    });
  };

  // --- tile cache (Storage Manager, optional) -------------------------------
  const [report, setReport] = createSignal<StorageReport | undefined>(undefined);
  const [busy, setBusy] = createSignal(false);
  /** Inline failure line for tile-cache actions (empty = none). */
  const [actionError, setActionError] = createSignal('');

  const refresh = async (): Promise<void> => {
    const storage = props.deps.storage;
    if (storage === undefined) return;
    setReport(await loadStorageReport(storage));
  };

  /** Total bytes across the reported (tile) namespaces. */
  const cacheBytes = createMemo<number>(() => {
    const rep = report();
    if (rep === undefined) return 0;
    return rep.namespaces.reduce((sum, ns) => sum + ns.bytes, 0);
  });

  const onClearCache = (): void => {
    const storage = props.deps.storage;
    if (storage === undefined || busy()) return;
    setBusy(true);
    setActionError('');
    void storage
      .clearTileCache()
      .then(() => refresh())
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        setActionError(t('appsettings.general.actionFailed', { message }));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  onMount(() => {
    void refresh();
  });

  return (
    <div class="mvp-appsettings__section" data-testid="appsettings-maps">
      <label class="mvp-appsettings__field">
        <span class="mvp-appsettings__label">{t('appsettings.maps.preset.label')}</span>
        <select
          class="mvp-appsettings__select"
          data-testid="appsettings-maps-preset"
          value={resolvedPresetId()}
          onChange={(e) => onPresetChange(e.currentTarget.value)}
        >
          <For each={BASEMAP_PRESETS}>
            {(preset) => <option value={preset.id}>{t(preset.labelKey)}</option>}
          </For>
        </select>
      </label>

      <Show when={showCustom()}>
        <label class="mvp-appsettings__field">
          <span class="mvp-appsettings__label">{t('appsettings.maps.url')}</span>
          <input
            type="text"
            class="mvp-appsettings__input"
            data-testid="appsettings-maps-url"
            placeholder={t('appsettings.maps.url.placeholder')}
            value={settings().mapSource?.urlTemplate ?? ''}
            onInput={(e) => setMapUrl(e.currentTarget.value)}
          />
        </label>

        <label class="mvp-appsettings__field">
          <span class="mvp-appsettings__label">{t('appsettings.maps.key')}</span>
          <input
            type="password"
            class="mvp-appsettings__input"
            data-testid="appsettings-maps-key"
            autocomplete="off"
            value={settings().mapSource?.apiKey ?? ''}
            onInput={(e) => setMapKey(e.currentTarget.value)}
          />
          <span class="mvp-appsettings__hint">{t('appsettings.maps.key.hint')}</span>
        </label>
      </Show>

      <Show when={props.deps.storage !== undefined}>
        <div class="mvp-appsettings__group" role="group" aria-label={t('appsettings.maps.cache')}>
          <h3>{t('appsettings.maps.cache')}</h3>
          <p class="mvp-appsettings__hint" data-testid="appsettings-maps-cache-size">
            {formatBytes(cacheBytes())}
          </p>
          <button
            type="button"
            class="mvp-appsettings__btn"
            data-testid="appsettings-maps-clear-cache"
            disabled={busy()}
            onClick={onClearCache}
          >
            {t('appsettings.maps.clearCache')}
          </button>
          <Show when={actionError() !== ''}>
            <p
              class="mvp-appsettings__hint"
              role="alert"
              data-testid="appsettings-maps-action-error"
            >
              {actionError()}
            </p>
          </Show>
        </div>
      </Show>
    </div>
  );
};
