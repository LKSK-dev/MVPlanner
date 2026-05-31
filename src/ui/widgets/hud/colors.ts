/**
 * HUD colour resolution (task T2.1; spec plan/05 §5.6 theming).
 *
 * The HUD is themeable via the app's `--mvp-*` design tokens. Most roles map
 * straight onto existing tokens; the sky/ground/horizon roles are HUD-specific
 * and fall back to sensible defaults. {@link readHudColors} reads the computed
 * custom properties off an element (so live theme switches are picked up on the
 * next redraw); {@link DEFAULT_HUD_COLORS} is the SSR/test-safe fallback.
 */
import type { HudColors } from './model';

/** Fallback palette (matches the Dark theme tokens) when CSS is unavailable. */
export const DEFAULT_HUD_COLORS: HudColors = {
  sky: '#2b6cb0',
  ground: '#7a5230',
  horizon: '#ffffff',
  ladder: '#e6edf3',
  text: '#e6edf3',
  textDim: '#9aa7b4',
  accent: '#3fb6ff',
  ok: '#3fb950',
  warn: '#d29922',
  error: '#f85149',
};

/** Read one CSS custom property off `style`, or `fallback` when empty. */
function readVar(style: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = style.getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

/**
 * Resolve the HUD palette from `el`'s computed `--mvp-*` tokens, falling back to
 * {@link DEFAULT_HUD_COLORS} for any unset value (and entirely when no element /
 * `getComputedStyle` is available, e.g. under happy-dom).
 *
 * HUD-specific roles use `--mvp-hud-*` tokens when present so a theme can tune
 * the sky/ground without touching the shared palette.
 */
export function readHudColors(el?: Element | null): HudColors {
  const view = el?.ownerDocument?.defaultView;
  if (!el || !view || typeof view.getComputedStyle !== 'function') {
    return DEFAULT_HUD_COLORS;
  }
  const s = view.getComputedStyle(el);
  const d = DEFAULT_HUD_COLORS;
  return {
    sky: readVar(s, '--mvp-hud-sky', d.sky),
    ground: readVar(s, '--mvp-hud-ground', d.ground),
    horizon: readVar(s, '--mvp-hud-horizon', d.horizon),
    ladder: readVar(s, '--mvp-text', d.ladder),
    text: readVar(s, '--mvp-text', d.text),
    textDim: readVar(s, '--mvp-text-dim', d.textDim),
    accent: readVar(s, '--mvp-accent', d.accent),
    ok: readVar(s, '--mvp-ok', d.ok),
    warn: readVar(s, '--mvp-warn', d.warn),
    error: readVar(s, '--mvp-error', d.error),
  };
}
