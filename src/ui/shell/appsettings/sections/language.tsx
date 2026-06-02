/**
 * App Settings → Language section (spec docs/appsettings §3/§9).
 *
 * Picks the display language from the registered locales ({@link listLocales}),
 * labelling each with its human-readable language name via `Intl.DisplayNames`
 * (falling back to the raw code). The choice is written to `settings.language`
 * through the coalesced `store.patch`; the shell's settings effects react to the
 * same field to switch the active locale. Store-/deps-injected, so it
 * unit-tests with a fresh `createAppStore()`.
 */
import { For, type Component } from 'solid-js';
import { listLocales } from '../../../../core/i18n';
import type { AppSettingsSectionDeps } from '../context';
import '../messages';
import '../appsettings.css';

/** Best-effort human language name for a locale code (falls back to the code). */
function localeLabel(code: string): string {
  try {
    const display = new Intl.DisplayNames([code], { type: 'language' });
    return display.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The Language section body. */
export const LanguageSection: Component<{ deps: AppSettingsSectionDeps }> = (props) => {
  const t = props.deps.t;
  const settings = props.deps.store.select((s) => s.settings);

  return (
    <div class="mvp-appsettings__group">
      <label class="mvp-appsettings__field">
        <span class="mvp-appsettings__label">{t('appsettings.language.label')}</span>
        <select
          class="mvp-appsettings__select"
          data-testid="appsettings-language"
          value={settings().language}
          onChange={(e): void => {
            const value = e.currentTarget.value;
            props.deps.store.patch((d) => {
              d.settings.language = value;
            });
          }}
        >
          <For each={listLocales()}>
            {(code) => <option value={code}>{localeLabel(code)}</option>}
          </For>
        </select>
      </label>
    </div>
  );
};
