/**
 * Appearance section of the App Settings pane (spec docs/appsettings §3/§7).
 *
 * Lets the user pick a base theme (built-in mode or an installed custom theme),
 * a UI density and custom palette color overrides, install/export portable
 * `.mvptheme.json` bundles, and manage installed themes (edit / save / remove).
 * Every control writes only into `settings.appearance`; the shell's appearance
 * effect is what actually applies the selection to the document (this section
 * never calls `applyAppearance`), resolving the active installed theme through
 * {@link effectiveAppearance}.
 *
 * Color inputs are validated with {@link isValidCssColor} before being written,
 * so a malformed value is surfaced inline (and skipped) instead of poisoning
 * the stored palette.
 */
import { For, Show, createSignal, onCleanup, type Component } from 'solid-js';
import type {
  AppearanceColorKey,
  AppearanceSettings,
  Density,
  InstalledTheme,
  ThemeMode,
} from '../../../../contracts';
import {
  APPEARANCE_COLOR_KEYS,
  DENSITIES,
  THEME_MODES,
  effectiveAppearance,
  installTheme,
  isValidCssColor,
  parseTheme,
  serializeTheme,
  uninstallTheme,
} from '../../../../core/theme';
import type { AppSettingsSectionDeps } from '../context';
import { LayoutControls } from './layout';

/** Match a 6-digit hex color the native `<input type=color>` can display. */
const HEX6 = /^#[0-9a-f]{6}$/i;

/** How long the transient "theme installed" hint stays visible. */
const THEME_SAVED_HINT_MS = 4000;

/** Theme-selector option value prefix for a built-in theme mode. */
const BUILTIN_PREFIX = 'builtin:';
/** Theme-selector option value prefix for an installed custom theme. */
const INSTALLED_PREFIX = 'theme:';

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
  /** Whether the last theme install failed to parse as an MVPlanner bundle. */
  const [importError, setImportError] = createSignal(false);
  /** Whether the last install succeeded (transient confirmation hint). */
  const [themeSaved, setThemeSavedRaw] = createSignal(false);

  let themeSavedTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    if (themeSavedTimer !== undefined) clearTimeout(themeSavedTimer);
  });
  /** Set the saved hint; when shown, auto-clear it after a few seconds. */
  const setThemeSaved = (value: boolean): void => {
    if (themeSavedTimer !== undefined) {
      clearTimeout(themeSavedTimer);
      themeSavedTimer = undefined;
    }
    setThemeSavedRaw(value);
    if (value) {
      themeSavedTimer = setTimeout(() => setThemeSavedRaw(false), THEME_SAVED_HINT_MS);
    }
  };
  /** Name to give the next installed theme (empty falls back to the default). */
  const [themeName, setThemeName] = createSignal('');

  /** Patch `settings.appearance`, preserving sibling fields via a fresh object. */
  const writeAppearance = (mut: (prev: AppearanceSettings) => AppearanceSettings): void => {
    deps.store.patch((d) => {
      d.settings.appearance = mut(d.settings.appearance ?? {});
    });
  };

  /** Installed themes in the library (empty when none installed). */
  const library = (): readonly InstalledTheme[] => appearance()?.themeLibrary ?? [];

  /** The `<select>` value reflecting the active built-in or installed theme. */
  const selectorValue = (): string => {
    const a = appearance();
    const id = a?.activeThemeId;
    if (id !== undefined && library().some((th) => th.id === id)) return `${INSTALLED_PREFIX}${id}`;
    return `${BUILTIN_PREFIX}${a?.themeMode ?? 'system'}`;
  };

  /** Select a built-in theme mode and drop any active installed theme. */
  const selectBuiltin = (mode: ThemeMode): void => {
    writeAppearance((prev) => {
      const next = { ...prev, themeMode: mode };
      delete next.activeThemeId;
      return next;
    });
  };

  /** Select an installed theme by id (its bundle applies via the shell). */
  const selectInstalled = (id: string): void => {
    writeAppearance((prev) => ({ ...prev, activeThemeId: id }));
  };

  /** Resolve a theme-selector option value to the matching write. */
  const onSelectTheme = (raw: string): void => {
    if (raw.startsWith(INSTALLED_PREFIX)) selectInstalled(raw.slice(INSTALLED_PREFIX.length));
    else if (raw.startsWith(BUILTIN_PREFIX)) {
      selectBuiltin(raw.slice(BUILTIN_PREFIX.length) as ThemeMode);
    }
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
    const current = effectiveAppearance(appearance()) ?? {};
    void deps.files.saveAs(
      new Blob([serializeTheme(current)], { type: 'application/json' }),
      'theme.mvptheme.json',
    );
  };

  /** Pick a `.mvptheme.json`, install it into the library and make it active. */
  const installFromFile = async (): Promise<void> => {
    const picked = await deps.files.openForRead(['.json', '.mvptheme.json']);
    if (picked === undefined) return;
    const parsed = parseTheme(await picked.blob.text());
    if (parsed === undefined) {
      setImportError(true);
      setThemeSaved(false);
      return;
    }
    setImportError(false);
    setInvalid({});
    const name = themeName().trim() || t('appsettings.appearance.defaultThemeName');
    writeAppearance((prev) => {
      const { library: lib, id } = installTheme(prev.themeLibrary, parsed, name);
      return { ...prev, themeLibrary: lib, activeThemeId: id };
    });
    setThemeName('');
    setThemeSaved(true);
  };

  /** Load an installed theme's bundle into the inline editor (live preview). */
  const editTheme = (entry: InstalledTheme): void => {
    const b = entry.bundle;
    writeAppearance((prev) => {
      const next = { ...prev };
      delete next.activeThemeId;
      if (b.themeMode !== undefined) next.themeMode = b.themeMode;
      else delete next.themeMode;
      if (b.colors !== undefined) next.colors = { ...b.colors };
      else delete next.colors;
      if (b.density !== undefined) next.density = b.density;
      else delete next.density;
      return next;
    });
    setInvalid({});
  };

  /** Write the current inline appearance back into a library entry's bundle. */
  const saveToTheme = (id: string): void => {
    writeAppearance((prev) => {
      const lib = (prev.themeLibrary ?? []).map((th) =>
        th.id === id
          ? {
              ...th,
              bundle: {
                ...(prev.themeMode !== undefined ? { themeMode: prev.themeMode } : {}),
                ...(prev.colors !== undefined ? { colors: { ...prev.colors } } : {}),
                ...(prev.density !== undefined ? { density: prev.density } : {}),
              },
            }
          : th,
      );
      return { ...prev, themeLibrary: lib };
    });
  };

  /** Remove an installed theme; clears the active id when it was selected. */
  const uninstall = (id: string): void => {
    writeAppearance((prev) => {
      const next = { ...prev, themeLibrary: uninstallTheme(prev.themeLibrary, id) };
      if (prev.activeThemeId === id) delete next.activeThemeId;
      return next;
    });
  };

  return (
    <div data-section-body="appearance">
      {/* Theme selector (built-in modes + installed custom themes) */}
      <div class="mvp-appsettings__field">
        <label class="mvp-appsettings__label" for="mvp-appearance-theme">
          {t('appsettings.appearance.theme')}
        </label>
        <select
          id="mvp-appearance-theme"
          class="mvp-appsettings__select"
          data-testid="appearance-theme"
          value={selectorValue()}
          onChange={(e) => onSelectTheme(e.currentTarget.value)}
        >
          <For each={THEME_MODES}>
            {(mode) => (
              <option value={`${BUILTIN_PREFIX}${mode}`}>
                {t(`appsettings.appearance.theme.${mode}`)}
              </option>
            )}
          </For>
          <For each={library()}>
            {(th) => <option value={`${INSTALLED_PREFIX}${th.id}`}>{th.name}</option>}
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

      {/* Install / export theme bundles */}
      <div class="mvp-appsettings__group">
        <div class="mvp-appsettings__field">
          <label class="mvp-appsettings__label" for="mvp-appearance-theme-name">
            {t('appsettings.appearance.themeName')}
          </label>
          <input
            id="mvp-appearance-theme-name"
            class="mvp-appsettings__input"
            type="text"
            data-testid="appearance-theme-name"
            placeholder={t('appsettings.appearance.defaultThemeName')}
            value={themeName()}
            onInput={(e) => setThemeName(e.currentTarget.value)}
          />
        </div>
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
            data-testid="appearance-install-theme"
            onClick={() => void installFromFile()}
          >
            {t('appsettings.appearance.installTheme')}
          </button>
        </div>
        <Show when={importError()}>
          <span class="mvp-appsettings__hint" data-testid="appearance-import-error">
            {t('appsettings.appearance.importError')}
          </span>
        </Show>
        <Show when={themeSaved()}>
          <span class="mvp-appsettings__hint" data-testid="appearance-theme-saved">
            {t('appsettings.appearance.themeSaved')}
          </span>
        </Show>
      </div>

      {/* Theme manager (installed custom themes only — built-ins are protected) */}
      <div class="mvp-appsettings__group" data-testid="appearance-theme-manager">
        <h3>{t('appsettings.appearance.installedThemes')}</h3>
        <Show
          when={library().length > 0}
          fallback={
            <p class="mvp-appsettings__hint" data-testid="appearance-no-installed">
              {t('appsettings.appearance.noInstalled')}
            </p>
          }
        >
          <For each={library()}>
            {(th) => (
              <div class="mvp-appsettings__field" data-testid={`appearance-theme-row-${th.id}`}>
                <span class="mvp-appsettings__label">{th.name}</span>
                <div class="mvp-appsettings__actions">
                  <button
                    type="button"
                    class="mvp-appsettings__btn"
                    data-testid={`appearance-edit-${th.id}`}
                    onClick={() => editTheme(th)}
                  >
                    {t('appsettings.appearance.edit')}
                  </button>
                  <button
                    type="button"
                    class="mvp-appsettings__btn"
                    data-testid={`appearance-save-${th.id}`}
                    onClick={() => saveToTheme(th.id)}
                  >
                    {t('appsettings.appearance.saveToTheme')}
                  </button>
                  <button
                    type="button"
                    class="mvp-appsettings__btn"
                    data-testid={`appearance-uninstall-${th.id}`}
                    onClick={() => uninstall(th.id)}
                  >
                    {t('appsettings.appearance.uninstall')}
                  </button>
                </div>
              </div>
            )}
          </For>
        </Show>
      </div>

      {/* Windows & layout (dockable workspace editor) */}
      <LayoutControls deps={props.deps} />
    </div>
  );
};
