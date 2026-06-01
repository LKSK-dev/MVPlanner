# Changelog

All notable changes to MVPlanner are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

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
