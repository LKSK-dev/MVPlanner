# Changelog

All notable changes to MVPlanner are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [0.5.0] — 2026-06-02

### Changed — repository-wide refactor (clean & consistent code; behavior-neutral)

- **Redundancy eliminated first**: one canonical `TFn` translate type (was declared
  34×), one `ConfirmFn` (10×), one `formatBytes` (4×), one shared dialog focus
  trap (4 inline copies), one pointer-drag lifecycle helper, one MAVLink decoded-
  field accessor (6×), shared duration/byte/error formatters, and a shared test
  helper module adopted across ~50 test files (hundreds of duplicated lines
  removed).
- **Dead code removed**: the migrated legacy Settings screen, its preview model,
  46 orphaned i18n keys, the superseded map aspect-clamp, and the never-used
  `@/` path alias.
- **Structure**: the storage-manager + network egress modules moved next to
  their only consumer (the MVPlanner Settings pane); i18n-only `register.ts`
  files renamed to `messages.ts`; inspector strings moved out of the central
  catalog; import-path styles normalized.
- **Size budget extended**: single-file artifact target ≤ 20 MB, hard limit
  ≤ 25 MB (was 5/8).

Contracts 1.8.0 (type-only additive: canonical `ConfirmFn`). No functional
changes intended; the full regression suite + live SITL gate verify behavior.

## [0.4.2] — 2026-06-02

### Fixed (full-repository audit, two passes — ~95 findings)

- **Survey missions are correct again**: generated waypoints were written un-scaled
  and collapsed to (0,0); they now round-trip exactly.
- **Recorded tlogs use real timestamps** (epoch microseconds — they previously
  read as 1970 in Mission Planner/pymavlink) and **tlog playback now advances**
  (position/timecode were frozen; old replays no longer leak as ghost telemetry).
- **Top bar shows live armed/mode/battery** for the active vehicle (was
  hardcoded “Disarmed / unknown”).
- **Motor “Test all in sequence” now actually runs sequentially** (it spun all
  motors at once).
- **Parameter safety**: Write all/changed and autotune are confirm-gated and the
  parameter set clears on vehicle switch (no cross-vehicle writes).
- **Plan**: transfer buttons lock while busy, fail fast when not connected, and
  replacing an edited mission (download/open/survey) asks first; fence parameter
  failures are reported.
- **Reliability**: FTP transactions serialize + cancel on dispose; mission ops
  match component ids; compass-cal timeout cancels the onboard cal; log-erase
  clears stale sizes; replay/bridge/host connection edge cases; persisted-store
  write ordering; map tile loads cancel on basemap switch/detach.
- **UX polish**: dialogs trap focus; concurrent confirms no longer hang; factory
  reset fails closed, reports errors, and reloads; shortcut labels follow
  rebinds; missing widgets show a placeholder; stale measure paths clear;
  plotter keeps your zoom; extension actions show busy/errors; antimeridian
  rendering fixed.

## [0.4.1] — 2026-06-02

### Fixed (UI-remake audit — see `docs/ui-remake/AUDIT.md`)

- **Dividers are now keyboard-resizable** (Arrow keys, Home to equalize,
  double-click to equalize, focus ring) — not mouse-only.
- **More widgets are addable**: Inspector, Quick-watch, Joystick, Antenna
  tracker and About now appear in the “Add widget” palette.
- Tab strips gain keyboard navigation + proper ARIA roles; widget categories are
  now translatable; the last-panel close guard updates reactively; added a
  “Reset workspace layout” command.

## [0.4.0] — 2026-06-02

### Changed — UI remake: customizable dockable workspaces

The UI is now a **dockable, tiling widget workspace** (built on the existing
layout engine; every widget component + the whole backend are reused, so no
feature was lost). Focus: stability, consistency, customizability.

- **Resize** any panel by dragging the dividers between panels (mouse +
  keyboard); sizes persist.
- **Tabs**: stack widgets behind a tab strip; consistent panel chrome
  everywhere (title + maximize/restore + close).
- **Workspaces**: each screen (Flight/Plan/Setup/Config/Logs/Sim) is now an
  **editable workspace preset**; the top-bar entries switch workspaces.
- **Configure in MVPlanner Settings → Appearance → Windows & layout**: pick the
  active workspace, **add widgets** from a catalog (including whole screens),
  **remove** widgets, and **reset a workspace to its default**.
- **Stability**: one pure, unit-tested layout engine; every widget is isolated
  by an **error boundary** (a faulty widget can never blank the app); persisted
  layouts are **schema-versioned + migrated** with a safe fallback to the
  presets (no white-screen on corrupt/old data).

Contracts 1.7.0 (additive): `PanelDef.meta?: WidgetMeta` + `PanelApi.settings`.
Floating/overlapping windows are intentionally out of scope (tiling + tabs only).
See `docs/ui-remake/{SPEC,PLAN}.md`.

## [0.3.3] — 2026-06-02

### Changed

- **Maps fill their pane** (no more letterbox dead space) — the map canvas now
  renders at the full size of its container on every screen.
- **Logs tab fills vertically** — the plot and map panes both grow to fill the
  stage (the map is no longer a short, centered, fixed-height strip), and a new
  **draggable splitter** (mouse + Arrow keys) lets you resize the plot/map split
  to fill the space how you like. (Supersedes the earlier 21:9 map clamp: a
  filled map is preferred over letterbox dead space.)

## [0.3.2] — 2026-06-02

### Changed

- **UI fills the window — no large dead space.** Removed the fixed width caps on
  screen content (Setup steps radio/motors/tracker/battery, the legacy Settings
  screen, the About panel) so content stretches to the full pane; form fields
  flow into responsive auto-fit columns, and Config Parameters/Tuning grow to
  fill their pane. Genuine overlays (the Settings/Connection drawers, command
  palette, toasts, install-prompt modal) stay intentionally bounded.

## [0.3.1] — 2026-06-02

### Fixed (code-audit follow-up)

- **Flight instruments now honor the unit setting** — the gauges/HUD were
  hard-wired to metric; they now render the selected unit system and per-quantity
  overrides (the last gap in “units everywhere”).
- **Map API key is no longer stored in plaintext** — the persisted settings slice
  redacts it; the key lives only in memory + the encrypted secret store.

### Changed

- Added a root **LICENSE** (ISC), a **nightly CI** job running the live SITL +
  perf suites, and a parity guard for the example-extension typings; `lint` is
  now warning-clean. See `docs/audit/CODE-AUDIT.md`.

## [0.3.0] — 2026-06-02

### Fixed

- **UI no longer clipped** by the window — the app fits the viewport and variable
  regions (e.g. the Plan waypoint list) scroll internally instead of being cut off.
- **Keybinds now work**: rebinding by pressing keys no longer triggers a command
  mid-capture, and a **manual entry** field accepts standard syntax (e.g.
  `Shift+1`) as a fallback to pressing.
- **Units honored everywhere**: the Measure tool (and plan/flight readouts) now
  render in the selected unit system instead of always metric.
- **Ctrl/right-click** to delete waypoints/plan elements no longer pops the
  browser context menu (suppressed app-wide, except in text fields).
- The **plan persists** when switching tabs (session-scoped).

### Added

- **MVPlanner Settings** (renamed from “Application Settings”); default open
  shortcut is now **Shift+S**.
- **Full per-quantity units**: independent unit selection for altitude, distance,
  speed, vertical speed, temperature, heading and coordinates (with a preset).
- **Theme install + manager**: “Install theme” adds a theme permanently to the
  selector; a manager lets you edit/uninstall custom themes (built-ins are
  protected). New **outline** color customization.
- **Extensions** section gains the **full mission-command list** (incl.
  `VTOL_TAKEOFF`/`VTOL_LAND`) plus a **Custom…** option to enter arbitrary
  `MAV_CMD` ids in the waypoint editor.
- A bundled **Hello World** example extension (top-bar box → overlay) to sanity
  check the extension system; top-bar extension contributions now render.
- The Measure tool uses a **ruler** icon.

Contracts 1.6.0 (additive): `AppearanceColorKey += outline`;
`AppearanceSettings += themeLibrary/activeThemeId`; `AppSettings += unitPreferences`.

## [0.2.0] — 2026-06-01

### Added — Application Settings pane

A left-hand **Application Settings** pane that slides out from the top-left
**MVPlanner** brand (or `Ctrl/⌘ + ,`). It hosts all app-wide preferences; it
holds no vehicle- or connection-specific settings.

- **Recents** — recently opened/saved plans, logs and parameter files, re-opened
  from an offline content cache.
- **Appearance** — base theme or **System (auto)**, custom **accent/text/surface/
  error/warning** colors (validated, live), **density** (comfortable/compact),
  and theme **import/export** (`.mvptheme.json`).
- **Units & Measurement** — unit system + coordinate format with a live preview.
- **Keybinds** — rebindable command shortcuts with conflict detection and
  per-row / all reset; a global dispatcher runs them (and never fires while
  typing).
- **Extensions** — the full extension manager (install from file, enable/disable,
  reload, uninstall, permission grants/revoke), sharing one controller with the
  Sim & Dev Tools hub so state stays in sync.
- **Language**, **Maps** (basemap presets — CARTO Dark/Light, OSM, Esri
  satellite — + custom URL/key + tile cache; changing the basemap updates the
  map live), and **General** (audio/confirm,
  telemetry rate, storage manager, network egress, and a redacted **settings
  backup** export/import).
- The former **Config → Settings** tab is removed; its settings migrated here.
- Persistence: settings are stored in the browser (IndexedDB/localStorage). When
  running from a file, an exported settings backup is the portable safeguard.

Contracts 1.5.0 (additive): `AppSettings.appearance` + `AppSettings.keybinds`.

## [0.1.0] — 2026-06-01

First public pre-release. MVPlanner is a modern, single-file (`MVPlanner.html`),
browser-based MAVLink ground control station — a Mission Planner successor that
runs entirely offline from `file://` with no install and no telemetry.

> Pre-release (0.x): interfaces and behavior may still change before 1.0.
> The bundled **extension API** is versioned separately (`EXT_API_VERSION`).

### Highlights

- **Single self-contained artifact** — one `MVPlanner.html` (~2.4 MB), no
  backend, no phone-home. Strict CSP; secrets (MAVLink signing key, map API key)
  encrypted at rest via WebCrypto; a Settings → Network egress panel.
- **MAVLink core** — full v1/v2 codec (validated against a pymavlink oracle),
  signing, a worker-hosted session, and a live inspector. ArduPilot + common
  dialects bundled.
- **Connectivity** — Web Serial, Web Bluetooth, WebSocket (via the optional
  companion bridge), WebRTC, and log replay transports, plus MAVLink forwarding
  to a secondary link.
- **Flight** — HUD, raster map (dark CARTO basemap by default with parent-tile
  fallback to avoid flashing during load), vehicle actions, quick controls,
  status, and a focus-loss-safe joystick/manual-control path (transport-gated).
- **Plan** — waypoints, survey grids, geofences, rally points, terrain, a map
  scale bar, and QGC `.waypoints` (WPL 110) + `.plan` file load/save.
- **Setup** — frame (Copter + Plane/QuadPlane VTOL), accel/compass/radio
  calibration, flight modes, failsafes, battery, and motor test.
- **Config** — parameter workbench, tuning, and persisted settings.
- **Logs & analysis** — DataFlash `.bin` and tlog open, plotting, map tracks,
  CSV export, playback, and a message sender.
- **Extensions & scripting** — a versioned extension API, permission-gated
  capabilities, a scripting console, 7 bundled examples, and a sandbox runtime
  for imported (untrusted) extensions.
- **Extras** — voice/audio alerts, an ADS-B traffic layer, and antenna-tracker
  support.
- **Quality** — accessibility (ARIA, keyboard nav, reduced-motion/contrast),
  i18n with pseudo-localization, RTL-aware styles, and a performance harness.

### Not in 0.1.0

- **Firmware flashing** is intentionally out of scope.
- Rendered axe/contrast sweeps, true 500 MB log opens, and live-hardware
  joystick/RC validation are tracked as browser/CI (Playwright) follow-ups.
- MapLibre vector basemaps are deferred (raster map engine ships in 0.1.0).

[0.1.0]: https://github.com/LKSK-dev/MVPlanner/releases/tag/v0.1.0
