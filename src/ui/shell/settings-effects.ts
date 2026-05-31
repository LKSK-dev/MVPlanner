/**
 * Reactive boot wiring from {@link AppSettings} to the theme + i18n runtimes
 * (T0.7; spec plan/05 §5.6/§5.9). This is intentionally minimal — the full
 * settings editor UI is T3.7. Here we only apply `settings.theme` and
 * `settings.language` at boot and whenever they change.
 *
 * Must be called inside a reactive owner (the {@link Shell} component body) so
 * the effects are disposed with the shell.
 */
import { createEffect } from 'solid-js';
import type { AppState, Store } from '../../contracts';
import { applyTheme } from '../../core/theme';
import { setLocale } from '../../core/i18n';

/** Apply theme + locale from the store and keep them in sync with settings. */
export function applySettingsEffects(store: Store<AppState>): void {
  const theme = store.select((s) => s.settings.theme);
  const language = store.select((s) => s.settings.language);
  createEffect(() => applyTheme(theme()));
  createEffect(() => setLocale(language()));
}
