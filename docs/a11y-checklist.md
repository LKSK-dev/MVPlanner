# Accessibility + i18n checklist (T8.11)

Spec: plan/05 §5.8 (a11y), §5.9 (i18n); plan/08 §8.6; plan/10 §10.5. Validation:
plan/implementation/05 §5.1 **V5** (axe per screen; contrast across themes;
pseudo-loc/RTL). Re-run at each release.

ARIA roles/labels/live-regions were built into the widgets throughout M0–M8;
this pass hardens i18n completeness, pseudo-loc, RTL/logical CSS, and pins the
no-hard-coded-strings discipline with sandbox-runnable unit tests. **Full
rendered-DOM axe scans per screen + contrast measurement across the four themes
remain the Playwright/axe CI gate (browser-deferred — nightly,
plan/implementation/05 §5.6).**

## Coverage matrix

| #   | Check                                                              | How verified (sandbox)                                                  | Status        |
| --- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------- |
| 1   | **i18n completeness** — all shell + 6-screen namespaces registered | `test/unit/i18n-completeness.test.ts` (loads the registered EN catalog) | ✅            |
| 2   | `t()` resolves every registered key; falls back to key (no crash)  | i18n-completeness test                                                  | ✅            |
| 3   | `{var}` interpolation correct                                      | i18n-completeness + i18n tests                                          | ✅            |
| 4   | **Pseudo-localization** utility (accent + ~40% expand + `⟦…⟧`)     | `src/core/i18n/pseudo.ts`; `test/unit/i18n-completeness-pseudo.test.ts` | ✅            |
| 5   | Pseudo-loc preserves `{var}` placeholders (interpolation survives) | pseudo test                                                             | ✅            |
| 6   | Pseudo-loc registerable as a locale (`en-XA`) + dev/test mode      | `registerPseudoLocale` / `enablePseudoLocale`; pseudo test              | ✅            |
| 7   | **No hard-coded UI strings** — no literal `aria-label`/`title`/…   | `test/unit/a11y-audit.test.ts` (static scan of `src/ui/**` `.tsx`)      | ✅            |
| 8   | No multi-word hard-coded JSX text nodes                            | a11y-audit test                                                         | ✅            |
| 9   | **RTL** — converted shell/table CSS uses logical box properties    | `test/unit/a11y-rtl.test.ts`                                            | ✅            |
| 10  | `prefers-reduced-motion` honored (motion token → 0ms)              | `src/core/theme/tokens.css` (T0.8)                                      | ✅            |
| 11  | `prefers-color-scheme` honored in system/auto mode                 | `src/core/theme/themes.css` (T0.8)                                      | ✅            |
| 12  | `prefers-contrast: more` honored in system/auto mode               | `src/core/theme/themes.css` (T0.8)                                      | ✅            |
| 13  | Live regions for alerts/STATUSTEXT                                 | `src/ui/widgets/messages` (`statustext.alerts.label`, role/aria-live)   | ✅ (built-in) |
| 14  | Focus management for modals / command palette                      | `src/ui/shell` palette + `ConfirmDialog` (M0)                           | ✅ (built-in) |
| 15  | ARIA labels/roles on shell controls + canvas textual equivalents   | HUD/plotter `aria-label` summaries; map zoom labels                     | ✅ (built-in) |
| 16  | Keyboard navigation + visible focus + logical tab order            | **Playwright e2e (browser-deferred)**                                   | ⏳ CI gate    |
| 17  | **axe** scan per screen (rendered DOM)                             | **Playwright + axe (browser-deferred)**                                 | ⏳ CI gate    |
| 18  | Min contrast **AA** across Dark/Light/High-contrast/Field themes   | **axe contrast in Playwright (browser-deferred)**                       | ⏳ CI gate    |
| 19  | Non-color status cues (icons/shapes alongside color)               | severity icons in messages/alerts; **visual review in e2e**             | ⏳ CI gate    |
| 20  | Pseudo-loc no-truncation across screens (rendered)                 | **Playwright with `en-XA` active (browser-deferred)**                   | ⏳ CI gate    |
| 21  | RTL mirrored layout (rendered with `dir="rtl"`)                    | **Playwright (browser-deferred)** — see `dir` note below                | ⏳ CI gate    |

## Keyboard nav / focus / live regions (built-in, M0–M8)

- **Command palette (⌘K)** and **ConfirmDialog** trap + restore focus (M0 shell);
  destructive in-air actions use the hold/typed confirm pattern (T2.7).
- **Live regions:** the STATUSTEXT console + alert center expose `aria-live`
  regions so screen readers announce vehicle messages/failsafes (T2.8 / T0.7).
- **Canvas widgets** (HUD, plotter) expose textual `aria-label` summaries for SR
  users (`hud.a11y.summary`, plotter `summary()`), per spec §5.8.
- **Labels/roles:** controls route their accessible names through `t()` — the
  a11y-audit test proves there are **zero** string-literal `aria-label`/`title`/
  `placeholder`/`alt` attributes and no multi-word hard-coded JSX text in
  `src/ui/**`.

## RTL / `dir` support note

- **Logical CSS:** the high-traffic shell + Plan data-table stylesheets were
  converted from physical to logical box properties so they mirror under RTL:
  - `margin-left: auto` → `margin-inline-start: auto` (top-bar status, conn hint)
  - `right: …` → `inset-inline-end: …` (toasts, floating panel)
  - `border-left: …` → `border-inline-start: …` (toast severity bar, conn drawer)
  - `text-align: left|right` → `start|end` (waypoint table, fence/rally/survey)
    Enforced by `test/unit/a11y-rtl.test.ts`.
- **Enabling RTL:** set `document.documentElement.dir = 'rtl'` (or `dir="rtl"` on
  `#app`). Because the converted surfaces use logical properties they flip
  automatically; the design-token spacing/typography is direction-agnostic. A
  locale→`dir` binding (e.g. auto-`rtl` for `ar`/`he`) is a small additive wiring
  in the shell and is **recommended as a follow-up** — out of this pass's
  surgical scope (no shipped RTL locale yet; English + pseudo-`en-XA` only).
- **Deferred (documented, not converted):** map/HUD **canvas-overlay corner
  positioning** (`src/ui/widgets/map/map.css`, `src/ui/screens/flight/flight.css`)
  still uses physical `left`/`right` for absolutely-positioned controls over the
  map canvas. These are visual corner anchors over a non-mirroring map surface;
  flipping them is lower-value and is left for the rendered RTL e2e pass.

## Pseudo-localization (dev/test mode)

`src/core/i18n/pseudo.ts` adds an English-derived pseudo-locale (`en-XA`):

- **Accented glyphs** — every catalog string renders as accented look-alikes, so
  any plain-ASCII text visible at runtime is a **hard-coded (non-`t()`) string**.
- **~40% length expansion** + **`⟦…⟧` boundary markers** — surface truncation /
  overflow and string-concatenation defects.
- `{var}` placeholders are preserved, so interpolation still works.
- Enable at runtime: `enablePseudoLocale()` (registers from the live English
  catalog + switches the active locale). The rendered-DOM sweep with `en-XA`
  active is the Playwright concern; the transform + wiring are unit-tested here.

## Residual risks / follow-ups

- **axe per-screen scans, AA contrast across the 4 themes, keyboard-nav e2e,
  rendered pseudo-loc truncation, and rendered RTL mirroring are
  browser-deferred** to the Playwright/axe nightly gate (V5,
  plan/implementation/05 §5.6). This pass delivers the sandbox-runnable slice and
  pins the no-hard-coded-strings + logical-CSS invariants as unit gates.
- **Locale→`dir` auto-binding** and **map/flight canvas-overlay RTL flip** are
  recommended additive follow-ups (see RTL note).
- No translated production locale ships yet (English + pseudo-`en-XA`); the
  community-locale loading path (`registerLocale`) is in place from T0.8.
