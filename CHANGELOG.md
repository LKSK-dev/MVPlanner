# Changelog

All notable changes to MVPlanner are documented here. This project adheres to
[Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-06-01

First public release. MVPlanner is a modern, single-file (`MVPlanner.html`),
browser-based MAVLink ground control station — a Mission Planner successor that
runs entirely offline from `file://` with no install and no telemetry.

### Highlights

- **Single self-contained artifact** — one `MVPlanner.html` (~2.44 MB), no
  backend, no phone-home. Strict CSP; secrets (MAVLink signing key, map API key)
  encrypted at rest via WebCrypto; a Settings → Network egress panel.
- **MAVLink core** — full v1/v2 codec (validated against a pymavlink oracle),
  signing, a worker-hosted session, and a live inspector. ArduPilot + common
  dialects bundled.
- **Connectivity** — Web Serial, Web Bluetooth, WebSocket (via the optional
  companion bridge), WebRTC, and log replay transports, plus MAVLink forwarding
  to a secondary link. An optional standalone Node bridge is included (never
  bundled).
- **Flight** — HUD, raster map, vehicle actions (arm/takeoff/RTL/guided/etc.),
  quick controls, status, and a focus-loss-safe joystick/manual-control path
  (transport-gated).
- **Plan** — waypoints, survey grids, geofences, rally points, terrain, and
  QGC `.waypoints` (WPL 110) + `.plan` file load/save.
- **Setup** — frame, accel/compass/radio calibration, flight modes, failsafes,
  battery, and motor test.
- **Config** — parameter workbench, tuning, and persisted settings.
- **Logs & analysis** — DataFlash `.bin` and tlog open, plotting, map tracks,
  CSV export, playback, and a message sender.
- **Extensions & scripting** — a frozen extension API (`EXT_API_VERSION` 1.0.0),
  permission-gated capabilities, a scripting console, 7 bundled examples, and a
  sandbox runtime for imported (untrusted) extensions.
- **Extras** — voice/audio alerts, an ADS-B traffic layer, and antenna-tracker
  support.
- **Quality** — accessibility (ARIA, keyboard nav, reduced-motion/contrast),
  i18n with pseudo-localization, RTL-aware styles, and a performance harness
  (telemetry > 800k msgs/sec; bounded-memory streaming `.bin` decode).

### Not in v1.0.0

- **Firmware flashing** is intentionally cut from v1.
- Rendered axe/contrast sweeps, true 500 MB log opens, and live-hardware
  joystick/RC validation are tracked as browser/CI (Playwright) follow-ups.
- MapLibre vector basemaps are deferred post-v1 (raster map engine ships in v1).

[1.0.0]: https://example.invalid/MVPlanner/releases/tag/v1.0.0
