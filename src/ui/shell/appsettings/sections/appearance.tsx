/**
 * Appearance section of the App Settings pane (spec docs/appsettings §3/§7).
 *
 * Lets the user pick a base theme mode (or "system"), a UI density and custom
 * palette color overrides, and import/export the whole selection as a portable
 * `.mvptheme.json` bundle. Every control writes only into
 * `settings.appearance`; the shell's appearance effect is what actually applies
 * the selection to the document (this section never calls `applyAppearance`).
 *
 * Color inputs are validated with {@link isValidCssColor} before being written,
 * so a malformed value is surfaced inline (and skipped) instead of poisoning
 * the stored palette.
 */
import { For, Show, createSignal, type Component } from 'solid-js';
import type {
  AppearanceColorKey,
  AppearanceSettings,
  Density,
  ThemeMode,
} from '../../../../contracts';
import {
  APPEARANCE_COLOR_KEYS,
  DENSITIES,
  THEME_MODES,
  isValidCssColor,
  parseTheme,
  serializeTheme,
} from '../../../../core/theme';
import type { AppSettingsSectionDeps } from '../context';

/** Match a 6-digit hex color the native `<input type=color>` can display. */
const HEX6 = /^#[0-9a-f]{6}$/i;

/**
 * The Appearance settings section. Reads from and writes to
 * `settings.appearance` via the injected store; the shell applies the result.
 */
export const AppearanceSection: Component<{ deps: AppSettingsSectionDeps }> = (props) => {
  const deps = props.deps;
  const t = deps.t;
  const appearance = deps.store.select((s) => s.settings.appearance);

  /** Per-key "not a valid color" flags (only set for non-empty bad input). */
  const [invalid, setInvalid] = createSignal<Partial<Record<AppearanceColorKey, boolean>>>({});
  /** Whether the last theme import failed to parse as an MVPlanner bundle. */
  const [importError, setImportError] = createSignal(false);

  /** Patch `settings.appearance`, preserving sibling fields via a fresh object. */
  const writeAppearance = (mut: (prev: AppearanceSettings) => AppearanceSettings): void => {
    deps.store.patch((d) => {
      d.settings.appearance = mut(d.settings.appearance ?? {});
    });
  };

  const setThemeMode = (mode: ThemeMode): void => {
    writeAppearance((prev) => ({ ...prev, themeMode: mode }));
  };

  const setDensity = (density: Density): void => {
    writeAppearance((prev) => ({ ...prev, density }));
  };

  const setColor = (key: AppearanceColorKey, value: string): void => {
    writeAppearance((prev) => ({ ...prev, colors: { ...(prev.colors ?? {}), [key]: value } }));
  };

  const resetColors = (): void => {
    setInvalid({});
    writeAppearance((prev) => {
      const next = { ...prev };
      delete next.colors;
      return next;
    });
  };

  /** Validate + (if valid) persist a color edit, tracking the invalid flag. */
  const onColorInput = (key: AppearanceColorKey, value: string): void => {
    const trimmed = value.trim();
    const valid = isValidCssColor(trimmed);
    setInvalid((prev) => ({ ...prev, [key]: trimmed !== '' && !valid }));
    if (valid) setColor(key, trimmed);
  };

  /** Current stored value for a color key (empty string when unset). */
  const colorValue = (key: AppearanceColorKey): string => appearance()?.colors?.[key] ?? '';

  /** Hex value the native swatch can render (falls back to black). */
  const swatchValue = (key: AppearanceColorKey): string => {
    const current = colorValue(key);
    return HEX6.test(current) ? current : '#000000';
  };

  const exportTheme = (): void => {
    const current = appearance() ?? {};
    void deps.files.saveAs(
      new Blob([serializeTheme(current)], { type: 'application/json' }),
      'theme.mvptheme.json',
    );
  };

  const importTheme = async (): Promise<void> => {
    const picked = await deps.files.openForRead(['.json', '.mvptheme.json']);
    if (picked === undefined) return;
    const patch = parseTheme(await picked.blob.text());
    if (patch === undefined) {
      setImportError(true);
      return;
    }
    setImportError(false);
    setInvalid({});
    writeAppearance((prev) => ({ ...prev, ...patch }));
  };

  return (
    <div data-section-body="appearance">
      {/* Theme mode */}
      <div class="mvp-appsettings__field">
        <label class="mvp-appsettings__label" for="mvp-appearance-theme">
          {t('appsettings.appearance.theme')}
        </label>
        <select
          id="mvp-appearance-theme"
          class="mvp-appsettings__select"
          data-testid="appearance-theme"
          value={appearance()?.themeMode ?? 'system'}
          onChange={(e) => setThemeMode(e.currentTarget.value as ThemeMode)}
        >
          <For each={THEME_MODES}>
            {(mode) => <option value={mode}>{t(`appsettings.appearance.theme.${mode}`)}</option>}
          </For>
        </select>
      </div>

      {/* Density */}
      <div class="mvp-appsettings__field">
        <label class="mvp-appsettings__label" for="mvp-appearance-density">
          {t('appsettings.appearance.density')}
        </label>
        <select
          id="mvp-appearance-density"
          class="mvp-appsettings__select"
          data-testid="appearance-density"
          value={appearance()?.density ?? 'comfortable'}
          onChange={(e) => setDensity(e.currentTarget.value as Density)}
        >
          <For each={DENSITIES}>
            {(density) => (
              <option value={density}>{t(`appsettings.appearance.density.${density}`)}</option>
            )}
          </For>
        </select>
      </div>

      {/* Custom colors */}
      <div class="mvp-appsettings__group">
        <h3>{t('appsettings.appearance.colors')}</h3>
        <For each={APPEARANCE_COLOR_KEYS}>
          {(key) => (
            <div class="mvp-appsettings__field">
              <label class="mvp-appsettings__label" for={`mvp-appearance-color-${key}`}>
                {t(`appsettings.appearance.color.${key}`)}
              </label>
              <div class="mvp-appsettings__color">
                <input
                  id={`mvp-appearance-color-${key}`}
                  class="mvp-appsettings__input"
                  type="text"
                  data-testid={`appearance-color-${key}`}
                  value={colorValue(key)}
                  onInput={(e) => onColorInput(key, e.currentTarget.value)}
                />
                <input
                  class="mvp-appsettings__swatch"
                  type="color"
                  aria-label={t(`appsettings.appearance.color.${key}`)}
                  data-testid={`appearance-swatch-${key}`}
                  value={swatchValue(key)}
                  onInput={(e) => onColorInput(key, e.currentTarget.value)}
                />
              </div>
              <Show when={invalid()[key] === true}>
                <span class="mvp-appsettings__hint" data-testid={`appearance-color-${key}-invalid`}>
                  {t('appsettings.appearance.color.invalid')}
                </span>
              </Show>
            </div>
          )}
        </For>
        <div class="mvp-appsettings__actions">
          <button
            type="button"
            class="mvp-appsettings__btn"
            data-testid="appearance-reset-colors"
            onClick={resetColors}
          >
            {t('appsettings.appearance.resetColors')}
          </button>
        </div>
      </div>

      {/* Import / export */}
      <div class="mvp-appsettings__group">
        <div class="mvp-appsettings__actions">
          <button
            type="button"
            class="mvp-appsettings__btn"
            data-testid="appearance-export-theme"
            onClick={exportTheme}
          >
            {t('appsettings.appearance.exportTheme')}
          </button>
          <button
            type="button"
            class="mvp-appsettings__btn"
            data-testid="appearance-import-theme"
            onClick={() => void importTheme()}
          >
            {t('appsettings.appearance.importTheme')}
          </button>
        </div>
        <Show when={importError()}>
          <span class="mvp-appsettings__hint" data-testid="appearance-import-error">
            {t('appsettings.appearance.importError')}
          </span>
        </Show>
      </div>
    </div>
  );
};
