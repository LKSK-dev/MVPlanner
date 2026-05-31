# `src/core/theme` — design tokens & theming

CSS custom-property design tokens and theme switching (T0.8; spec `plan/05`
§5.6/§5.8). Themes are **token sets** selected via the `<html data-theme>`
attribute.

## Contract (public surface — import from `src/core/theme`)

- `THEME_IDS` — the four built-in themes: `dark`, `light`, `high-contrast`,
  `field` (aligned with `ThemeId` in `src/contracts`).
- `applyTheme(themeId)` — set `<html data-theme>`; CSS token sets do the rest.
- `getActiveTheme()` — the explicitly-applied theme, or `undefined` in
  system/auto mode.
- `clearTheme()` — remove the attribute so the app follows the OS preferences.
- `prefersReducedMotion()`, `prefersHighContrast()`, `prefersDarkScheme()` —
  thin `matchMedia` readers (spec `plan/05` §5.8).
- `systemTheme()` — resolve the auto-mode theme from `prefers-*` (mirrors the
  CSS auto rules: contrast wins; light only when explicitly preferred; else
  dark).

## Owned files

- `tokens.css` — **stable entry imported by `src/main.tsx`** (do not move/rename).
  Holds theme-independent shape/typography/motion tokens + base element styles +
  `prefers-reduced-motion` handling; `@import`s `themes.css`.
- `themes.css` — the four color token sets + system/auto `prefers-color-scheme`
  / `prefers-contrast` rules (applied only when no explicit `data-theme`).
- `apply.ts` — `applyTheme`/`getActiveTheme`/`clearTheme` + `prefers-*` readers.
- `index.ts` — public barrel.

## Tokens

Color tokens (per theme): `--mvp-bg`, `--mvp-surface`, `--mvp-surface-2`,
`--mvp-border`, `--mvp-text`, `--mvp-text-dim`, `--mvp-accent`, `--mvp-ok`,
`--mvp-warn`, `--mvp-error`. Shared (theme-independent): `--mvp-radius`,
`--mvp-gap`, `--mvp-font`, `--mvp-font-mono`, `--mvp-motion-duration`.

## How to test

```
npx vitest run test/unit/theme.test.ts
```

`applyTheme` is asserted via `document.documentElement.getAttribute('data-theme')`.
Per-theme contrast (axe) is covered at the milestone gate / T8.11.
