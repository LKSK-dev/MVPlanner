/**
 * Theme module public surface (T0.8).
 *
 * Token sets live in `tokens.css` (entry, imported by `src/main.tsx`) and
 * `themes.css`. This module switches between them via `<html data-theme>` and
 * exposes the OS `prefers-*` preferences (spec plan/05 §5.6/§5.8).
 *
 * @see ./tokens.css — stable CSS entry; imports `themes.css`.
 * @see ./themes.css — Dark/Light/High-contrast/Field token sets + auto rules.
 */
export {
  THEME_IDS,
  applyTheme,
  clearTheme,
  getActiveTheme,
  prefersDarkScheme,
  prefersHighContrast,
  prefersReducedMotion,
  systemTheme,
} from './apply';
