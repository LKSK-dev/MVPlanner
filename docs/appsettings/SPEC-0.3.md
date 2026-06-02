# Application Settings — Specification v0.3 (revision)

Builds on `SPEC.md`. Covers the changes to the **MVPlanner Settings** pane for
the 0.3 batch (rename, per‑quantity units, theme install/manager + outline
color, keybinds fix + manual entry + new default). Bugs/features outside the
pane are specified in `PLAN-0.3.md`.

## 1. Rename

- The pane title and all references change from **“Application Settings”** to
  **“MVPlanner Settings”** (`appsettings.title`). The brand tooltip/command/aria
  copy follow.

## 2. Sections (updated set)

Recents · Appearance · **Units** · Keybinds · Language · Maps · Extensions ·
General · About. Units is promoted to a richer per‑quantity editor (§4); the rest
unchanged except Appearance (§3) and Keybinds (§5).

## 3. Appearance — themes install/manager + outline color

### 3.1 Theme library (install, not just import)

- The current **Import theme** action becomes **Install theme**: it parses a
  `.mvptheme.json` bundle and **adds it permanently** to a named **theme
  library** persisted in settings, then selects it. Installed themes appear in
  the **theme selector** alongside the built‑ins.
- Theme selector options:
  `System (auto)` · `Dark` · `Light` · `High contrast` · `Field` · _(installed
  custom themes…)_. Selecting an installed theme applies its saved appearance
  bundle (base theme/mode + colors + density).
- **Theme manager** (a sub‑panel under the selector + color editor): lists
  installed custom themes with **Edit** (load its colors/mode/density into the
  live editor for tweaking + re‑save) and **Uninstall** (remove from the
  library). **Built‑in themes cannot be uninstalled or edited** (no manage row).
- **Export theme** stays (exports the current appearance as a bundle).

### 3.2 Data model

- `AppearanceSettings` gains:
  - `themeLibrary?: InstalledTheme[]` where
    `InstalledTheme = { id: string; name: string; bundle: ThemeBundle }`.
  - `activeThemeId?: string` — when set and present in the library, the active
    appearance is taken from that installed theme; otherwise the inline
    `themeMode`/`colors`/`density` apply (back‑compat).
- Built‑ins are **not** stored in the library; they are the existing
  `THEME_MODES`. The library holds only user‑installed themes.
- Install = validate `parseTheme` → push `{id: uid, name, bundle}` →
  `activeThemeId = id`. Edit = copy the installed theme’s bundle into the live
  inline editor + clear `activeThemeId` (so edits preview live) with a **Save to
  theme** action that writes back to the library entry. Uninstall = drop the
  entry; if it was active, fall back to inline appearance.

### 3.3 Outline color

- Add **outline** to the custom color keys (`AppearanceColorKey` +=
  `'outline'`), mapping to the canonical **`--mvp-border`** token. The color
  editor shows an Outline swatch + hex input; `ThemeBundle.colors` may include
  `outline`; `applyAppearance` writes `--mvp-border` from it.

## 4. Units — full per‑quantity selection

### 4.1 Quantities

Independent unit selection for: **altitude**, **distance**, **speed**,
**vertical speed (climb)**, **temperature**, **coordinate format**, **heading**.
(Voltage/current/percent stay system‑independent.)

### 4.2 Model

- New `UnitPreferences` (all optional; absent ⇒ derived from the `units` preset):
  ```ts
  interface UnitPreferences {
    altitude?: 'm' | 'ft';
    distance?: 'm' | 'km' | 'ft' | 'mi' | 'nm';
    speed?: 'm/s' | 'km/h' | 'kt' | 'mph';
    verticalSpeed?: 'm/s' | 'ft/min';
    temperature?: 'C' | 'F';
    coordinate?: CoordinateFormat; // mirrors existing coordinateFormat
    heading?: 'deg' | 'mil';
  }
  ```
- `AppSettings` gains `unitPreferences?: UnitPreferences`. The existing
  `units: UnitSystem` remains the **preset** (Metric/Imperial) that fills any
  quantity the user has not overridden; `coordinateFormat` stays the source of
  truth for coordinates (mirrored by `unitPreferences.coordinate`).
- A pure resolver `resolveUnits(settings) → ResolvedUnits` returns the concrete
  unit for every quantity (preset default unless overridden). A
  `createUnitFormatter(resolved)` facade exposes
  `altitude(m)/distance(m)/speed(ms)/climb(ms)/temperature(c)/heading(deg)/coord(lat,lon)`
  built over the existing `core/units` formatters + `geo/format`.

### 4.3 UI

- The Units section shows a **preset** select (Metric/Imperial) + an **Advanced
  (per‑quantity)** group with one select per quantity (defaulting to the preset
  value, “Auto (preset)” first). A live **preview** reflects the resolved units.

### 4.4 Application (bug fix scope)

- The Measure tool and other surfaces must use the resolver/formatter so they
  honor the selected units (fixes “Measure tool still metric”). Map‑layer
  `formatDistanceM`/`formatAreaM2` take a unit (or the measure controller formats
  via the facade). High‑visibility consumers (measure, plan readouts, HUD/gauges
  where they take a `UnitSystem`) are switched to the resolved per‑quantity unit;
  remaining call sites already taking `UnitSystem` continue to honor the preset.

## 5. Keybinds — fix + manual entry + new default

### 5.1 Fix (capture)

- Root cause: the shell’s global keydown dispatcher fires during rebind capture
  and consumes the chord. Add a **capture lock**: a shared signal
  (`keybindCapturing`) the section raises while capturing and the dispatcher
  checks (`if (capturing) return;`). Capture then reliably records the chord.

### 5.2 Manual entry (fallback)

- Each row also has a **text input** for typing a chord in standard syntax
  (e.g. `Shift+1`, `Ctrl+K`, `Mod+,`). On commit (Enter/blur) it is parsed via
  `normalizeChord` (alias/oder‑tolerant); invalid input is rejected with a hint;
  conflicts are blocked like capture. This is the robust fallback to pressing.

### 5.3 New default

- The default chord to open the pane changes to **`Shift+S`** (`app.settings.open`
  shortcut `shift+s`); the brand `aria-keyshortcuts` + tooltip update. (The
  palette stays `Mod+K`.) Existing user overrides are preserved.

## 6. Persistence

All new fields are additive optionals on `AppSettings`
(`unitPreferences`, `appearance.themeLibrary`, `appearance.activeThemeId`,
`AppearanceColorKey += outline`), so older persisted state stays valid. Contracts
bump to **1.6.0**. Theme bundles redact nothing new (no secrets). Settings‑bundle
export/import carries the new fields.

## 7. A11y / i18n

All new copy via `t()` under `appsettings.*`; selects/inputs labelled; theme
manager rows have accessible Edit/Uninstall labels; the keybind manual input has
a label + describedby for the syntax hint; pseudo‑loc clean; RTL‑safe.

## 8. Acceptance

1. Pane title reads **MVPlanner Settings**; opens with **Shift+S**.
2. Rebinding works by **pressing** (no command fires during capture) **and** by
   **typing** `Shift+1`; conflicts blocked; reset restores defaults; persists.
3. Selecting **Imperial** (or per‑quantity imperial units) makes the **Measure
   tool** and plan readouts show imperial; per‑quantity overrides apply.
4. **Install theme** adds a theme to the selector permanently; the **theme
   manager** edits/uninstalls custom themes but cannot remove built‑ins;
   **outline** color customization works.
5. Full gate green; size within budget.
