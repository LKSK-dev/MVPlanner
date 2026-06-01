/**
 * App Settings screen (task T3.7; spec plan/04 §4.5 planner/app settings,
 * plan/05 §5.4 Settings).
 *
 * Edits `store.settings` through `store.patch` — unit system, coordinate format,
 * theme, language, audio alerts, destructive-action confirmation, the custom map
 * tile source (URL template + optional key) and the default telemetry rate. A
 * live **preview** (via `core/units` + `geo/format`) shows how the chosen
 * unit/coordinate selection renders, mirroring the formatters used across the
 * app. Theme + language are applied app-wide by the shell's settings effects
 * (`ui/shell/settings-effects.ts`) reacting to the same store fields — this
 * screen only writes them.
 *
 * The Storage Manager (spec plan/07 §7.3) is injected via {@link StorageManagerDeps}
 * so it is testable without IndexedDB: it reports usage + per-namespace sizes and
 * runs the clear-tiles / factory-reset / export-settings actions through the
 * injected handles. The screen is store-/deps-injected, so it unit-tests with a
 * fresh `createAppStore()` and fakes.
 */
import { For, Show, createMemo, createSignal, onMount, type Component } from 'solid-js';
import { listLocales, t as defaultT } from '../../../../core/i18n';
import { THEME_IDS } from '../../../../core/theme';
import type {
  AppState,
  ConfirmOptions,
  CoordinateFormat,
  Store,
  ThemeId,
  UnitSystem,
} from '../../../../contracts';
import { buildPreview } from './preview';
import {
  exportSettings,
  loadStorageReport,
  type StorageManagerDeps,
  type StorageReport,
} from './storage-manager';
import { NetworkSection, type NetworkSectionDeps } from './network';
import './messages';
import './settings.css';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Safety-confirm seam (the shell `UiRegistry.confirm`). */
export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

/** Selectable unit systems, in display order. */
const UNIT_OPTIONS: readonly UnitSystem[] = ['metric', 'imperial'];
/** Selectable coordinate formats, in display order. */
const COORD_OPTIONS: readonly CoordinateFormat[] = ['dd', 'dms', 'utm', 'mgrs'];
/** Binary byte-size unit ladder for {@link formatBytes}. */
const BYTE_UNITS: readonly string[] = ['KiB', 'MiB', 'GiB', 'TiB'];
/**
 * Placeholder shown in the telemetry-rate field. The field itself stays
 * `undefined` by default (see {@link createDefaultAppState}); this is only the
 * suggested value surfaced to the user.
 */
const DEFAULT_TELEMETRY_RATE_HZ = 4;

/** {@link SettingsScreen} props. */
export interface SettingsScreenProps {
  /** The shared app store (settings source + write target). */
  store: Store<AppState>;
  /** i18n translate function (default the app `t`). */
  t?: TFn;
  /**
   * Injected Storage Manager handles (spec plan/07 §7.3). When omitted the
   * storage section renders a disabled "unavailable" state.
   */
  storage?: StorageManagerDeps;
  /** Safety-confirm seam for the factory reset (default `window.confirm`). */
  confirm?: ConfirmFn;
  /**
   * Injected Settings → Network egress-transparency sources (spec plan/07 §7.7).
   * When omitted the Network section is not rendered.
   */
  network?: NetworkSectionDeps;
}

/** Format a byte count as a compact binary human-readable size. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < BYTE_UNITS.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${BYTE_UNITS[i] ?? 'TiB'}`;
}

/** Best-effort human language name for a locale code (falls back to the code). */
function localeLabel(code: string): string {
  try {
    const display = new Intl.DisplayNames([code], { type: 'language' });
    return display.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The App Settings screen. */
export const SettingsScreen: Component<SettingsScreenProps> = (props) => {
  const t = props.t ?? defaultT;
  const settings = props.store.select((s) => s.settings);

  /** Patch a mutable draft of `settings` through the coalesced store write. */
  const patchSettings = (mutate: (draft: AppState['settings']) => void): void => {
    props.store.patch((d) => mutate(d.settings));
  };

  const confirmFn: ConfirmFn =
    props.confirm ??
    ((opts): Promise<boolean> => {
      const ask = (globalThis as { confirm?: (m?: string) => boolean }).confirm;
      return Promise.resolve(
        typeof ask === 'function' ? ask(`${opts.title}\n\n${opts.body}`) : true,
      );
    });

  // --- live preview (recomputes on unit/coord change) -----------------------
  const preview = createMemo(() =>
    buildPreview({ units: settings().units, coordinateFormat: settings().coordinateFormat }),
  );

  // --- map source writers (preserve the sibling field) ----------------------
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

  // --- telemetry rate writer ------------------------------------------------
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

  // --- storage manager ------------------------------------------------------
  const [report, setReport] = createSignal<StorageReport | undefined>(undefined);
  const [busy, setBusy] = createSignal(false);

  const refreshReport = async (): Promise<void> => {
    const deps = props.storage;
    if (deps === undefined) return;
    setReport(await loadStorageReport(deps));
  };
  const run = (action: (deps: StorageManagerDeps) => Promise<void>): void => {
    const deps = props.storage;
    if (deps === undefined || busy()) return;
    setBusy(true);
    void action(deps)
      .then(() => refreshReport())
      .catch(() => undefined)
      .finally(() => setBusy(false));
  };

  const onClearTiles = (): void => run((deps) => deps.clearTileCache());
  const onClearAll = (): void =>
    run(async (deps) => {
      const ok = await confirmFn({
        title: t('settings.storage.clearAll.confirm.title'),
        body: t('settings.storage.clearAll.confirm.body'),
        destructive: true,
      });
      if (ok) await deps.clearAllData();
    });
  const onExport = (): void => run((deps) => exportSettings(deps, props.store.get().settings));

  onMount(() => {
    void refreshReport();
  });

  const usageText = createMemo<string>(() => {
    const est = report()?.estimate;
    if (est?.usage === undefined || est.quota === undefined) {
      return t('settings.storage.usage.unknown');
    }
    return t('settings.storage.usage.value', {
      used: formatBytes(est.usage),
      quota: formatBytes(est.quota),
    });
  });

  return (
    <section class="mvp-settings" role="region" aria-label={t('settings.region.label')}>
      {/* General ----------------------------------------------------------- */}
      <section class="mvp-settings__section" aria-label={t('settings.section.general')}>
        <h2 class="mvp-settings__heading">{t('settings.section.general')}</h2>

        <label class="mvp-settings__field">
          <span class="mvp-settings__label">{t('settings.units.label')}</span>
          <select
            class="mvp-settings__select"
            data-testid="settings-units"
            value={settings().units}
            onChange={(e) => {
              const value = e.currentTarget.value as UnitSystem;
              patchSettings((s) => {
                s.units = value;
              });
            }}
          >
            <For each={UNIT_OPTIONS}>
              {(u) => <option value={u}>{t(`settings.units.${u}`)}</option>}
            </For>
          </select>
        </label>

        <label class="mvp-settings__field">
          <span class="mvp-settings__label">{t('settings.coord.label')}</span>
          <select
            class="mvp-settings__select"
            data-testid="settings-coord"
            value={settings().coordinateFormat}
            onChange={(e) => {
              const value = e.currentTarget.value as CoordinateFormat;
              patchSettings((s) => {
                s.coordinateFormat = value;
              });
            }}
          >
            <For each={COORD_OPTIONS}>
              {(c) => <option value={c}>{t(`settings.coord.${c}`)}</option>}
            </For>
          </select>
        </label>

        <label class="mvp-settings__field">
          <span class="mvp-settings__label">{t('settings.theme.label')}</span>
          <select
            class="mvp-settings__select"
            data-testid="settings-theme"
            value={settings().theme}
            onChange={(e) => {
              const value = e.currentTarget.value as ThemeId;
              patchSettings((s) => {
                s.theme = value;
              });
            }}
          >
            <For each={THEME_IDS}>
              {(id) => <option value={id}>{t(`settings.theme.${id}`)}</option>}
            </For>
          </select>
        </label>

        <label class="mvp-settings__field">
          <span class="mvp-settings__label">{t('settings.language.label')}</span>
          <select
            class="mvp-settings__select"
            data-testid="settings-language"
            value={settings().language}
            onChange={(e) => {
              const value = e.currentTarget.value;
              patchSettings((s) => {
                s.language = value;
              });
            }}
          >
            <For each={listLocales()}>
              {(code) => <option value={code}>{localeLabel(code)}</option>}
            </For>
          </select>
        </label>

        <label class="mvp-settings__check">
          <input
            type="checkbox"
            data-testid="settings-audio"
            checked={settings().audioAlerts}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              patchSettings((s) => {
                s.audioAlerts = checked;
              });
            }}
          />
          <span class="mvp-settings__label">{t('settings.audio.label')}</span>
        </label>

        <label class="mvp-settings__check">
          <input
            type="checkbox"
            data-testid="settings-confirm"
            checked={settings().confirmDestructive}
            onChange={(e) => {
              const checked = e.currentTarget.checked;
              patchSettings((s) => {
                s.confirmDestructive = checked;
              });
            }}
          />
          <span class="mvp-settings__label">{t('settings.confirm.label')}</span>
        </label>
      </section>

      {/* Map source -------------------------------------------------------- */}
      <section class="mvp-settings__section" aria-label={t('settings.section.map')}>
        <h2 class="mvp-settings__heading">{t('settings.section.map')}</h2>

        <label class="mvp-settings__field">
          <span class="mvp-settings__label">{t('settings.map.url.label')}</span>
          <input
            type="text"
            class="mvp-settings__input"
            data-testid="settings-map-url"
            placeholder={t('settings.map.url.placeholder')}
            value={settings().mapSource?.urlTemplate ?? ''}
            onInput={(e) => setMapUrl(e.currentTarget.value)}
          />
        </label>

        <label class="mvp-settings__field">
          <span class="mvp-settings__label">{t('settings.map.key.label')}</span>
          <input
            type="password"
            class="mvp-settings__input"
            data-testid="settings-map-key"
            autocomplete="off"
            value={settings().mapSource?.apiKey ?? ''}
            onInput={(e) => setMapKey(e.currentTarget.value)}
          />
          <span class="mvp-settings__hint">{t('settings.map.key.hint')}</span>
        </label>
      </section>

      {/* Telemetry --------------------------------------------------------- */}
      <section class="mvp-settings__section" aria-label={t('settings.section.telemetry')}>
        <h2 class="mvp-settings__heading">{t('settings.section.telemetry')}</h2>

        <label class="mvp-settings__field">
          <span class="mvp-settings__label">{t('settings.telemetry.rate.label')}</span>
          <input
            type="number"
            min="0"
            step="1"
            class="mvp-settings__input"
            data-testid="settings-telemetry-rate"
            placeholder={String(DEFAULT_TELEMETRY_RATE_HZ)}
            value={settings().telemetryRateHz ?? ''}
            onInput={(e) => setTelemetryRate(e.currentTarget.value)}
          />
          <span class="mvp-settings__hint">{t('settings.telemetry.rate.hint')}</span>
        </label>
      </section>

      {/* Preview ----------------------------------------------------------- */}
      <section class="mvp-settings__section" aria-label={t('settings.section.preview')}>
        <h2 class="mvp-settings__heading">{t('settings.section.preview')}</h2>
        <dl class="mvp-settings__preview">
          <dt>{t('settings.preview.coord')}</dt>
          <dd data-testid="settings-preview-coord">{preview().coordinate}</dd>
          <dt>{t('settings.preview.altitude')}</dt>
          <dd data-testid="settings-preview-altitude">{preview().altitude}</dd>
          <dt>{t('settings.preview.distance')}</dt>
          <dd data-testid="settings-preview-distance">{preview().distance}</dd>
          <dt>{t('settings.preview.speed')}</dt>
          <dd data-testid="settings-preview-speed">{preview().speed}</dd>
        </dl>
      </section>

      {/* Storage manager --------------------------------------------------- */}
      <section class="mvp-settings__section" aria-label={t('settings.section.storage')}>
        <h2 class="mvp-settings__heading">{t('settings.section.storage')}</h2>

        <Show
          when={props.storage !== undefined}
          fallback={
            <p class="mvp-settings__hint" data-testid="settings-storage-unavailable">
              {t('settings.storage.unavailable')}
            </p>
          }
        >
          <p class="mvp-settings__usage">
            <span class="mvp-settings__label">{t('settings.storage.usage.label')}</span>{' '}
            <span data-testid="settings-storage-usage">{usageText()}</span>
          </p>

          <h3 class="mvp-settings__subheading">{t('settings.storage.namespaces.label')}</h3>
          <ul class="mvp-settings__namespaces" data-testid="settings-storage-namespaces">
            <Show
              when={(report()?.namespaces.length ?? 0) > 0}
              fallback={<li class="mvp-settings__hint">{t('settings.storage.empty')}</li>}
            >
              <For each={report()?.namespaces ?? []}>
                {(row) => (
                  <li class="mvp-settings__namespace" data-ns={row.ns}>
                    <span class="mvp-settings__namespace-name">
                      {t('settings.storage.namespace.row', { ns: row.ns })}
                    </span>
                    <span class="mvp-settings__namespace-detail">
                      {t('settings.storage.namespace.detail', {
                        size: formatBytes(row.bytes),
                        count: row.count,
                      })}
                    </span>
                  </li>
                )}
              </For>
            </Show>
          </ul>

          <div
            class="mvp-settings__actions"
            role="group"
            aria-label={t('settings.section.storage')}
          >
            <button
              type="button"
              class="mvp-settings__btn"
              data-testid="settings-refresh"
              disabled={busy()}
              onClick={() => void refreshReport()}
            >
              {t('settings.storage.refresh')}
            </button>
            <button
              type="button"
              class="mvp-settings__btn"
              data-testid="settings-export"
              disabled={busy()}
              onClick={onExport}
            >
              {t('settings.storage.export')}
            </button>
            <button
              type="button"
              class="mvp-settings__btn"
              data-testid="settings-clear-tiles"
              disabled={busy()}
              onClick={onClearTiles}
            >
              {t('settings.storage.clearTiles')}
            </button>
            <button
              type="button"
              class="mvp-settings__btn mvp-settings__btn--danger"
              data-testid="settings-clear-all"
              disabled={busy()}
              onClick={onClearAll}
            >
              {t('settings.storage.clearAll')}
            </button>
          </div>
        </Show>
      </section>

      {/* Network (egress transparency) ------------------------------------ */}
      <Show when={props.network !== undefined}>
        <NetworkSection store={props.store} deps={props.network as NetworkSectionDeps} t={t} />
      </Show>
    </section>
  );
};
