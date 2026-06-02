/**
 * Custom appearance layer for the App Settings pane (spec docs/appsettings).
 *
 * Sits on top of the attribute-driven base themes (`apply.ts` + `themes.css`):
 * applies a user's chosen theme mode, custom palette color overrides and UI
 * density. Color overrides are written as inline custom properties on the root
 * element so they win over the base theme token set without editing any CSS
 * file; the canonical tokens (`--mvp-accent`/`--mvp-text`/`--mvp-surface`/
 * `--mvp-error`/`--mvp-warn`) cascade through the alias block in `tokens.css`.
 *
 * The validation + serialization helpers are pure and DOM-free (unit-tested);
 * {@link applyAppearance} / {@link clearColorOverrides} are thin DOM wrappers.
 */
import type {
  AppearanceColorKey,
  AppearanceSettings,
  Density,
  InstalledTheme,
  ThemeId,
  ThemeMode,
} from '../../contracts';
import { applyTheme, clearTheme, systemTheme, THEME_IDS } from './apply';

/** Canonical palette keys a custom color may override, in display order. */
export const APPEARANCE_COLOR_KEYS = [
  'accent',
  'text',
  'surface',
  'outline',
  'error',
  'warn',
] as const satisfies readonly AppearanceColorKey[];

/** Map a color key to the canonical CSS custom property it overrides. */
const COLOR_KEY_TO_VAR: Record<AppearanceColorKey, string> = {
  accent: '--mvp-accent',
  text: '--mvp-text',
  surface: '--mvp-surface',
  outline: '--mvp-border',
  error: '--mvp-error',
  warn: '--mvp-warn',
};

/** UI density values, in display order. */
export const DENSITIES = ['comfortable', 'compact'] as const satisfies readonly Density[];

/** Theme modes the Appearance section offers (base themes + system/auto). */
export const THEME_MODES = ['system', ...THEME_IDS] as const satisfies readonly ThemeMode[];

/**
 * Strict CSS color validator. Accepts `#rgb`/`#rgba`/`#rrggbb`/`#rrggbbaa`,
 * `rgb()/rgba()`, `hsl()/hsla()` and a small set of plain keywords. Rejects
 * anything with `url(`, `expression`, semicolons, braces or other characters
 * that could break out of a `property: value` declaration (CSS-injection-safe).
 */
export function isValidCssColor(value: string): boolean {
  const v = value.trim();
  if (v.length === 0 || v.length > 64) return false;
  // No declaration/structure-breaking characters.
  if (/[;{}()]/.test(v) && !/^(?:rgb|rgba|hsl|hsla)\(/i.test(v)) return false;
  if (/[;{}<>\\]/.test(v) || /url\s*\(/i.test(v) || /expression/i.test(v)) return false;
  if (/^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return true;
  if (/^rgba?\(\s*[\d.\s,%/]+\)$/i.test(v)) return true;
  if (/^hsla?\(\s*[\d.\s,%/deg]+\)$/i.test(v)) return true;
  if (/^[a-z]{3,20}$/i.test(v)) return true; // named keyword (e.g. "tomato")
  return false;
}

/**
 * Build the inline custom-property override map from validated colors. Invalid
 * or empty values are skipped, so a partial/garbage input degrades gracefully.
 */
export function buildColorOverrides(
  colors: Partial<Record<AppearanceColorKey, string>> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (colors === undefined) return out;
  for (const key of APPEARANCE_COLOR_KEYS) {
    const raw = colors[key];
    if (typeof raw === 'string' && raw.trim() !== '' && isValidCssColor(raw)) {
      out[COLOR_KEY_TO_VAR[key]] = raw.trim();
    }
  }
  return out;
}

/** Resolve the effective theme id for a mode (`system` → `prefers-*`). */
export function resolveThemeMode(mode: ThemeMode | undefined, fallback: ThemeId): ThemeId {
  if (mode === undefined) return fallback;
  if (mode === 'system') return systemTheme();
  return mode;
}

function rootElement(): HTMLElement | undefined {
  return typeof document !== 'undefined' ? document.documentElement : undefined;
}

/** Remove every custom color override from the root element. */
export function clearColorOverrides(): void {
  const root = rootElement();
  if (root === undefined) return;
  for (const cssVar of Object.values(COLOR_KEY_TO_VAR)) {
    root.style.removeProperty(cssVar);
  }
}

/**
 * Apply an {@link AppearanceSettings} to the document: base theme (or system),
 * UI density (`data-density`) and the validated custom color overrides (inline
 * custom properties). Safe to call repeatedly; clears stale overrides first.
 *
 * @param appearance - The appearance settings (may be undefined/partial).
 * @param baseTheme - The `settings.theme` to use when `themeMode` is unset.
 */
/**
 * The appearance to actually apply: when an installed theme is active
 * ({@link AppearanceSettings.activeThemeId} present in `themeLibrary`), its saved
 * bundle wins; otherwise the inline `themeMode`/`colors`/`density` apply.
 */
export function effectiveAppearance(
  appearance: AppearanceSettings | undefined,
): AppearanceSettings | undefined {
  if (appearance === undefined) return undefined;
  const id = appearance.activeThemeId;
  if (id === undefined) return appearance;
  const found = appearance.themeLibrary?.find((th) => th.id === id);
  if (found === undefined) return appearance;
  const b = found.bundle;
  return {
    ...(b.themeMode !== undefined ? { themeMode: b.themeMode } : {}),
    ...(b.colors !== undefined ? { colors: b.colors } : {}),
    ...(b.density !== undefined ? { density: b.density } : {}),
  };
}

/** Generate a short unique id for an installed theme. */
function themeId(): string {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Install a theme bundle into a library, returning the new library + id. */
export function installTheme(
  library: readonly InstalledTheme[] | undefined,
  appearance: AppearanceSettings,
  name: string,
): { library: InstalledTheme[]; id: string } {
  const id = themeId();
  const entry: InstalledTheme = {
    id,
    name,
    bundle: {
      ...(appearance.themeMode !== undefined ? { themeMode: appearance.themeMode } : {}),
      ...(appearance.colors !== undefined ? { colors: appearance.colors } : {}),
      ...(appearance.density !== undefined ? { density: appearance.density } : {}),
    },
  };
  return { library: [...(library ?? []), entry], id };
}

/** Remove an installed theme from a library. */
export function uninstallTheme(
  library: readonly InstalledTheme[] | undefined,
  id: string,
): InstalledTheme[] {
  return (library ?? []).filter((th) => th.id !== id);
}

export function applyAppearance(
  appearance: AppearanceSettings | undefined,
  baseTheme: ThemeId,
): void {
  const root = rootElement();
  if (root === undefined) return;
  const eff = effectiveAppearance(appearance);

  const mode = eff?.themeMode ?? baseTheme;
  if (mode === 'system') clearTheme();
  else applyTheme(mode);

  const density: Density = eff?.density ?? 'comfortable';
  if (density === 'compact') root.setAttribute('data-density', 'compact');
  else root.removeAttribute('data-density');

  clearColorOverrides();
  const overrides = buildColorOverrides(eff?.colors);
  for (const [cssVar, value] of Object.entries(overrides)) {
    root.style.setProperty(cssVar, value);
  }
}

/** A portable theme bundle (exported/imported as `.mvptheme.json`). */
export interface ThemeBundle {
  readonly kind: 'mvplanner-theme';
  readonly version: 1;
  readonly themeMode?: ThemeMode;
  readonly colors?: Partial<Record<AppearanceColorKey, string>>;
  readonly density?: Density;
}

/** Serialize an appearance selection to a {@link ThemeBundle} JSON string. */
export function serializeTheme(appearance: AppearanceSettings): string {
  const bundle: ThemeBundle = {
    kind: 'mvplanner-theme',
    version: 1,
    ...(appearance.themeMode !== undefined ? { themeMode: appearance.themeMode } : {}),
    ...(appearance.colors !== undefined ? { colors: appearance.colors } : {}),
    ...(appearance.density !== undefined ? { density: appearance.density } : {}),
  };
  return JSON.stringify(bundle, null, 2);
}

/**
 * Parse + validate a theme bundle JSON string into an {@link AppearanceSettings}
 * patch. Unknown keys are dropped, colors validated, theme mode/density checked
 * against the known sets. Returns `undefined` for anything that is not a valid
 * MVPlanner theme bundle.
 */
export function parseTheme(json: string): AppearanceSettings | undefined {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const obj = data as Record<string, unknown>;
  if (obj['kind'] !== 'mvplanner-theme') return undefined;

  const out: AppearanceSettings = {};

  const mode = obj['themeMode'];
  if (typeof mode === 'string' && (THEME_MODES as readonly string[]).includes(mode)) {
    out.themeMode = mode as ThemeMode;
  }

  const density = obj['density'];
  if (typeof density === 'string' && (DENSITIES as readonly string[]).includes(density)) {
    out.density = density as Density;
  }

  const colors = obj['colors'];
  if (typeof colors === 'object' && colors !== null) {
    const src = colors as Record<string, unknown>;
    const picked: Partial<Record<AppearanceColorKey, string>> = {};
    for (const key of APPEARANCE_COLOR_KEYS) {
      const value = src[key];
      if (typeof value === 'string' && isValidCssColor(value)) picked[key] = value.trim();
    }
    if (Object.keys(picked).length > 0) out.colors = picked;
  }

  return out;
}
