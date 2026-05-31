/**
 * Theme switching + `prefers-*` readers (T0.8).
 *
 * Themes are CSS custom-property token sets (`tokens.css` / `themes.css`)
 * selected via the `<html data-theme>` attribute (spec plan/05 §5.6). This
 * module only sets/reads that attribute and exposes the OS accessibility
 * preferences (spec plan/05 §5.8); it owns no token values itself.
 */
import type { ThemeId } from '../../contracts';

/** All built-in theme ids; their token sets are defined in `themes.css`. */
export const THEME_IDS = [
  'dark',
  'light',
  'high-contrast',
  'field',
] as const satisfies readonly ThemeId[];

/** The `<html>` attribute that selects the active token set. */
const THEME_ATTR = 'data-theme';

function rootElement(): HTMLElement | undefined {
  return typeof document !== 'undefined' ? document.documentElement : undefined;
}

function isThemeId(value: string): value is ThemeId {
  return (THEME_IDS as readonly string[]).includes(value);
}

/**
 * Apply a built-in theme by setting `<html data-theme>`. CSS token sets in
 * `themes.css` do the rest, so switching is instant and reversible.
 */
export function applyTheme(themeId: ThemeId): void {
  rootElement()?.setAttribute(THEME_ATTR, themeId);
}

/**
 * Read the explicitly-applied theme, or `undefined` when none is set (i.e. the
 * app is in system/auto mode and follows `prefers-*`).
 */
export function getActiveTheme(): ThemeId | undefined {
  const value = rootElement()?.getAttribute(THEME_ATTR);
  return value && isThemeId(value) ? value : undefined;
}

/**
 * Remove the explicit theme so the app follows the OS `prefers-color-scheme` /
 * `prefers-contrast` token sets in `themes.css`.
 */
export function clearTheme(): void {
  rootElement()?.removeAttribute(THEME_ATTR);
}

function matchesMedia(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(query).matches
    : false;
}

/** True when the user prefers reduced motion (spec plan/05 §5.8). */
export function prefersReducedMotion(): boolean {
  return matchesMedia('(prefers-reduced-motion: reduce)');
}

/** True when the user prefers increased contrast. */
export function prefersHighContrast(): boolean {
  return matchesMedia('(prefers-contrast: more)');
}

/** True when the OS reports a dark color scheme. */
export function prefersDarkScheme(): boolean {
  return matchesMedia('(prefers-color-scheme: dark)');
}

/**
 * Resolve the theme to use in system/auto mode from `prefers-*`. Mirrors the
 * CSS auto rules in `themes.css`: increased contrast wins; otherwise light only
 * when the OS explicitly prefers it; dark is the default.
 */
export function systemTheme(): ThemeId {
  if (prefersHighContrast()) return 'high-contrast';
  return matchesMedia('(prefers-color-scheme: light)') ? 'light' : 'dark';
}
