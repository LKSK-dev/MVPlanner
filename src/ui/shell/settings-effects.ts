/**
 * Reactive boot wiring from {@link AppSettings} to the theme + i18n runtimes
 * (T0.7; spec plan/05 §5.6/§5.9; App Settings appearance — docs/appsettings §6).
 * Applies `settings.appearance` (theme mode incl. System, custom colors, UI
 * density) over the base `settings.theme`, and `settings.language`, at boot and
 * whenever they change.
 *
 * Must be called inside a reactive owner (the {@link Shell} component body) so
 * the effects are disposed with the shell.
 */
import { createEffect } from 'solid-js';
import type { AppState, Store } from '../../contracts';
import { applyAppearance } from '../../core/theme';
import { setLocale } from '../../core/i18n';

/** Apply theme/appearance + locale from the store and keep them in sync. */
export function applySettingsEffects(store: Store<AppState>): void {
  const theme = store.select((s) => s.settings.theme);
  const appearance = store.select((s) => s.settings.appearance);
  const language = store.select((s) => s.settings.language);
  // Reads both signals so the effect re-applies on either change. The custom
  // layer resolves theme mode (incl. System), density and color overrides.
  createEffect(() => applyAppearance(appearance(), theme()));
  createEffect(() => setLocale(language()));
}
