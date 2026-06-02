# Application Settings — Specification

Status: draft for implementation · Target: MVPlanner 0.2.0
Owner: orchestrator · Related: `src/ui/shell/**`, `src/core/theme/**`,
`src/core/store/**`, `src/ui/screens/config/settings/**`.

## 1. Summary

A left-hand **Application Settings pane** that slides out when the top‑left
**“MVPlanner”** brand is clicked. It hosts every _application‑wide_ setting
(appearance, units, keybinds, language, maps, general/advanced) plus a
**Recents** launcher. It deliberately hosts **no** vehicle‑specific data and
**no** connection settings (those stay in the Connection drawer and the
Setup/Config vehicle screens). Settings persist locally so they survive reloads,
including when the app is opened from `file://`.

This replaces the **Config → Settings** tab: its contents migrate into the pane
and the Config tab is removed.

## 2. Goals / Non‑goals

### Goals

- One discoverable home for all app‑wide preferences, opened from the brand.
- Migrate the existing app settings (units, coordinate format, theme, language,
  audio alerts, confirm‑destructive, map source/key, telemetry rate, Storage
  Manager, Network egress) without regressions.
- New capabilities: **Recents**, **Appearance** customization (theme + custom
  colors + density + import/export themes), **Keybinds** (rebindable command
  shortcuts), **Maps** presets.
- Robust local persistence + a portable **settings bundle** export/import.
- Fully keyboard‑accessible, themed, i18n’d, and unit‑tested.

### Non‑goals (explicitly deferred; noted in §10)

- Full drag‑and‑drop dock/widget layout _editor_. v1 exposes density + workspace
  save/reset/restore only (the dock tree editor remains a later feature).
- Per‑vehicle or per‑connection settings (out of scope by requirement).
- Cloud sync / accounts. Everything is local‑first.
- Writing settings literally back into the `MVPlanner.html` file (not possible
  for a sandboxed page); see §8 for the real persistence model.

## 3. Entry point & shell placement

- The top bar brand `MVPlanner` (`src/ui/shell/topbar.tsx`) becomes a
  `<button class="mvp-brand">` with `aria-haspopup="dialog"`,
  `aria-expanded`, `aria-controls="mvp-appsettings"`, and
  `aria-keyshortcuts` (default `Control+,` / `Meta+,`).
- Clicking it (or the shortcut, or a command‑palette command
  `app.settings.open`) toggles the pane.
- The pane is a **left overlay drawer** mirroring the right‑side Connection
  drawer (`src/ui/shell/connection/drawer.tsx`):
  - `role="dialog"`, `aria-modal` semantics, labelled by its heading.
  - Focus moves in on open; restored to the brand button on close.
  - **Escape** closes; a backdrop click closes; a visible **×** close button.
  - Slides from the left; respects `prefers-reduced-motion`.
  - Width: `clamp(320px, 30vw, 460px)`; full height; internal scroll per section.

## 4. Layout of the pane

```
┌─ App Settings ───────────────  [×] ┐
│  [search settings…]                 │   (optional filter, v1: simple text filter)
│  ┌──────────┬───────────────────┐   │
│  │ Recents  │                   │   │
│  │ Appearance│  <active section> │   │
│  │ Units    │                   │   │
│  │ Keybinds │                   │   │
│  │ Language │                   │   │
│  │ Maps     │                   │   │
│  │ General  │                   │   │
│  │ About    │                   │   │
│  └──────────┴───────────────────┘   │
└─────────────────────────────────────┘
```

- A vertical **section rail** (left) + the active **section body** (right). On
  narrow widths the rail collapses to a top row of chips.
- Section nav is a `role="tablist"`/`tab`/`tabpanel` pattern (arrow‑key
  navigable). Active section persisted to `appearance.lastSettingsSection` so
  reopening lands where you left.

## 5. Sections (functional spec)

### 5.1 Recents

- Lists recently **opened/saved** plans, logs, tlogs and param files, newest
  first, grouped or filterable by kind.
- Each row: kind icon, file name, relative time, size; actions **Open** and
  **Remove**. A **Clear recents** action.
- **Open** behaviour (browser‑portable, offline‑capable):
  - When an entry has cached content (see §8.3) it re‑opens directly from the
    cache without a file picker (works from `file://`, no FS permission).
  - When content was not cached (e.g. a very large log above the cache cap) the
    row is metadata‑only and **Open** re‑invokes the file picker (best effort);
    a hint explains why.
- Recording: opening a plan/log/tlog/param (and saving a plan/param) appends an
  entry via a `RecentsStore` (see §7.3). Capped at `N = 20` entries and a total
  cached‑content budget (default 16 MiB); oldest evicted first.
- Privacy: recents are local only; **Clear recents** purges both metadata and
  cached blobs. Covered by the existing factory‑reset.

### 5.2 Appearance

- **Theme**: choose a base theme (`dark`, `light`, `high-contrast`, `field`) or
  **System** (auto, follows `prefers-*`).
- **Custom colors**: override the core palette tokens — **accent**, **text**,
  **surface** (background) — plus derived **error/warn** optionally. Live preview
  while editing; applied as an inline custom‑property layer on `<html>` over the
  base theme (see §6). A **Reset colors** clears overrides.
- **Density**: `comfortable` (default) | `compact` — sets a root `data-density`
  attribute that token spacing keys react to.
- **Themes import/export**: export the current theme (base id + color overrides
  - density) as a `.mvptheme.json` file; import one to apply + (optionally) save
    it to a small named **theme library** in storage. Imported JSON is validated
    and color values sanitized (see §9).
- **Layout (v1 scope)**: buttons to **Save current workspace**, **Restore
  default layout**, and pick a saved workspace — reusing the existing
  `workspace.ts` model. (A full drag‑drop pane/widget editor is deferred, §10.)

### 5.3 Units & Measurement

- **Unit system**: `metric` | `imperial`.
- **Coordinate format**: `dd` | `dms` | `utm` | `mgrs`.
- Live **preview** block (reuses `buildPreview`) showing a sample coordinate,
  altitude, distance and speed in the selected units/format.

### 5.4 Keybinds

- Lists registered commands (id + human title + current chord). Grouped by area
  where a group prefix exists (e.g. `nav.*`, `widget.*`).
- **Rebind**: click a row → “Press a key…” capture; records the chord
  (modifiers + key) as an override. **Conflict detection**: warns and refuses to
  bind a chord already in use (offer to reassign). **Reset** per‑row and **Reset
  all** restore defaults.
- A **global key dispatcher** in the shell listens for `keydown`, resolves the
  active chord → command id (user override else the command’s default
  `shortcut`), and runs it — unless focus is in a text input/textarea/select or
  a `contenteditable` (typing must never trigger a binding), except for a small
  allowlist (Escape, the palette toggle).
- Defaults derive from each `CommandDef.shortcut` and a built‑in default table
  for the always‑present chords (palette `Mod+K`, settings `Mod+,`).

### 5.5 Language

- Locale select (from `listLocales()`), with human language names via
  `Intl.DisplayNames`. Applies immediately via the existing settings effect.
- Includes the dev/test pseudo‑locale (`en-XA`) when registered.

### 5.6 Maps

- **Basemap preset** picker with built‑ins: **CARTO Dark** (default), **CARTO
  Light**, **OpenStreetMap**, **Esri World Imagery (satellite)**, **Custom**.
- **Custom**: URL template (`{z}/{x}/{y}`, `{s}`, `{apiKey}` …) + optional API
  key (password field; treated as a local secret, redacted from exports — as
  today). Selecting a preset writes `settings.mapSource`; “Custom” reveals the
  fields. A non‑empty `mapSource` overrides the built‑in default at runtime
  (this also closes the current gap where `settings.mapSource` is not applied to
  the engine — see §7.4).
- **Tile cache**: show cache size and a **Clear tile cache** action (from the
  Storage Manager handles).

### 5.7 General / Advanced

- **Audio alerts** (on/off master) and **Confirm destructive actions** (on/off).
- **Telemetry default rate** (Hz; blank = adaptive default).
- **Storage**: usage estimate, per‑namespace breakdown, **Clear tile cache**,
  **Factory reset** (destructive, confirmed).
- **Settings bundle**: **Export settings** (`.mvpsettings.json` — settings +
  appearance + keybinds + theme library, secrets redacted) and **Import
  settings** (validated, merged, applied).
- **Network (egress transparency)**: the existing `NetworkSection`
  (configured tile host, active link, extension `net:` grants, live egress log,
  “no analytics” statement).

### 5.8 Extensions

- Embeds the existing extension manager (`ui/screens/sim` `ExtensionsManager`)
  bound to the **same** `ExtensionsController` the Sim & Dev Tools hub drives, so
  install-from-file, enable/disable, reload, uninstall and permission
  grant/revoke actions stay in sync across both surfaces. Shown only when an
  extension system is wired (absent in mock-host/test contexts).

### 5.9 About

- Reuse/link the existing About content (app/API versions, build hash, bundled
  dialects, NOTICES viewer). Either embed the About panel or provide a button
  that opens it. (Keeps a single discoverable “About”.)

## 6. Theming model (custom colors + density)

- Base theme stays attribute‑driven: `<html data-theme=…>` selecting token sets
  in `themes.css` (System mode = remove the attribute, follow `prefers-*`).
- **Custom color overrides** are applied as inline CSS custom properties on the
  root element (`document.documentElement.style.setProperty('--mvp-accent', …)`)
  — a thin layer that wins over the base theme without editing token files.
  Overrides map to the canonical tokens (`--mvp-accent`, `--mvp-text`,
  `--mvp-surface`, `--mvp-error`, `--mvp-warn`) and their alias block added in
  the high‑contrast pass.
- **Density** sets `<html data-density="compact|comfortable">`; spacing tokens
  gain `[data-density="compact"]` overrides in `tokens.css`.
- A pure `core/theme/custom.ts` owns: validate a color, build the override map,
  apply/clear overrides, and (de)serialize a theme bundle. Pure + unit‑tested;
  DOM application is a thin wrapper.

## 7. State, contracts & persistence

### 7.1 AppSettings extensions (additive; bump `CONTRACTS_VERSION` → 1.5.0)

Add optional fields to `AppSettings` (back‑compatible; older persisted state and
defaults remain valid):

```ts
interface AppearanceSettings {
  /** Base theme, or 'system' to follow prefers-*. */
  themeMode?: ThemeId | 'system';
  /** Canonical token color overrides (hex/rgb strings), validated on apply. */
  colors?: Partial<Record<'accent' | 'text' | 'surface' | 'error' | 'warn', string>>;
  density?: 'comfortable' | 'compact';
  /** Last open settings section id (UI memory). */
  lastSettingsSection?: string;
}

interface AppSettings {
  // …existing fields unchanged…
  appearance?: AppearanceSettings;
  /** command id → key chord override (e.g. "app.settings.open" → "mod+,"). */
  keybinds?: Record<string, string>;
}
```

- `settings.theme`/`settings.language` remain the source of truth the existing
  shell effects already react to; `appearance.themeMode='system'` is applied by
  extending the effect to call `clearTheme()` + `systemTheme()` watch.
- The frozen `Store`/`AppState` shape is unchanged except for these optional
  `AppSettings` members.

### 7.2 Persistence

- The store already persists `settings` + `layout` (debounced) to the injected
  `KvStore` and rehydrates on boot (`app-store.ts`). New optional fields ride
  along automatically. No migration needed; absent fields fall back to defaults.

### 7.3 RecentsStore (new, KvStore + BlobStore backed)

- `createRecentsStore({ kv, blobs, now, maxEntries?, maxCacheBytes? })`.
- Metadata list under `kv('recents','list')`: `RecentEntry[]`
  `{ id, kind, name, openedAt, sizeBytes, cached: boolean }`.
- Cached content under `blobs('recents', id)` when `sizeBytes ≤ cap`.
- API: `record({kind,name,blob})`, `list()` (reactive accessor), `open(id)` →
  `{name, blob}` from cache or `undefined`, `remove(id)`, `clear()`. Eviction by
  count + total bytes (oldest first). Pure list/eviction logic unit‑tested with
  fakes.

### 7.4 Map source application (bug‑adjacent fix)

- A small `basemapFromSettings(settings)` resolver maps `mapSource` (or a chosen
  preset) → `BasemapSource`, defaulting to the built‑in CARTO dark when unset.
  The Flight/Plan/Logs engines call `engine.setBasemap(...)` reactively from
  `settings.mapSource`, closing the gap where the Maps settings currently do not
  reach the renderer.

### 7.5 Keybind registry (new)

- `core/keybinds/`: a pure chord model (`parseChord`, `formatChord`,
  `normalizeChord`, `matchEvent(e) → chord`) + a `KeybindRegistry` that holds the
  default table (seeded from registered commands’ `shortcut`) merged with user
  overrides, exposes `resolve(chord) → commandId`, conflict checks, and
  serialize/deserialize. The shell installs one global `keydown` listener that
  ignores typing targets and dispatches via the registry → `registry.run(id)`.

## 8. Persistence model & the `file://` requirement

- **What “stored within the HTML file” means in practice:** a sandboxed page
  cannot rewrite its own `.html` on disk. MVPlanner persists app settings in the
  browser’s per‑origin storage (IndexedDB, with a localStorage fallback) via the
  existing `KvStore`. This survives reloads and tab restarts.
- **`file://` caveat:** some browsers scope/cap `file://` storage differently
  (or clear it aggressively). To make persistence robust and portable we add the
  **settings bundle** export/import (§5.7): a one‑click `.mvpsettings.json` the
  user can keep next to the HTML and re‑import. This is the supported way to
  carry settings across machines or storage resets.
- **Auto‑restore hint:** on first run after an import, the bundle is applied and
  persisted to the live store. (No automatic file reads on `file://` — imports
  are always user‑initiated, per the security model.)
- Secrets (map API key, signing keys) are **never** included in plaintext
  exports (redacted), consistent with the existing Storage Manager export.

## 9. Security, a11y, i18n

- **Security:** imported theme/settings JSON is parsed defensively; color values
  validated against a strict hex/rgb(a)/hsl regex (no `url()`, no
  `expression`, no CSS injection) before being written as custom properties;
  unknown keys ignored; size‑bounded. No secrets in exports. Respects CSP.
- **A11y:** the pane is a labelled dialog with focus management + Escape;
  section nav is an ARIA tablist; every control has a label; color pickers have
  text hex inputs; keybind capture announces via a live region; honors
  `prefers-reduced-motion`/`prefers-contrast`.
- **i18n:** all copy via `t()` under an `appsettings.*` namespace; pseudo‑loc
  clean (no hard‑coded strings); RTL‑safe (logical properties; the pane mirrors
  to the right under `dir="rtl"`).

## 10. Deferred (post‑v1, documented)

- Drag‑and‑drop dock/widget layout editor (v1: density + workspace
  save/restore/reset only).
- Per‑widget appearance (individual widget color/scale overrides).
- Keybind chords with sequences (multi‑stroke); v1 supports single chords.
- Syncing/exporting recents content across machines (recents are local‑only).

## 11. Acceptance criteria

1. Clicking the **MVPlanner** brand toggles a left pane; Escape/×/backdrop close;
   focus is managed; `Mod+,` and `app.settings.open` also toggle it.
2. All former **Config → Settings** controls work from the pane; the Config
   Settings tab is removed (no dead tab, no lost functionality).
3. **Appearance**: changing theme/custom colors/density updates the UI live and
   persists across reload; import/export theme round‑trips.
4. **Recents**: opening a plan/log/param records an entry; **Open** re‑loads it
   from cache; **Clear** empties it; capped/evicted correctly.
5. **Keybinds**: a rebound chord triggers its command; conflicts are blocked;
   typing in inputs never triggers a binding; reset restores defaults; persists.
6. **Units/Language/Maps** apply live and persist; selecting a basemap preset
   changes the rendered map (map source now reaches the engine).
7. **Settings bundle** export/import round‑trips (secrets redacted).
8. Full gate green (typecheck/test/lint/format/build); a11y/i18n clean; the
   single‑file size stays within budget.
