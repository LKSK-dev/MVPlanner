# `src/core/audio` — voice/audio alerts

Task T8.7 implements a testable voice + tone alert layer for vehicle telemetry.

## Public API

- `detectAlerts(prev, next, opts)` — pure transition detector. It inspects mode,
  arm/disarm, battery threshold crossings, GPS fix loss, EKF health loss and
  optional `STATUSTEXT`-like events. It returns deduped/rate-limited
  `AudioAlert` records and performs no side effects.
- `detectStatusTextAlerts(event, vehicle, opts)` — pure detector for event-only
  `STATUSTEXT` handling.
- `createAudioAlertService(deps)` — mutable service that stores previous vehicle
  snapshots, owns rate-limit history, persists settings through an injected
  `KvStore`, and calls injected `speak`/`tone` seams for fired alerts.

## Injection seams

`AudioAlertServiceDeps` accepts:

- `store?: KvStore` — persists settings under `core.audio/settings` when present.
- `speak?: AudioSpeak` — defaults to Web Speech API `speechSynthesis`.
- `tone?: AudioTone` — defaults to a lazy `AudioContext` beeper.
- `now?: () => number` — deterministic clock for tests.
- `translate?: (key, vars) => string` — defaults to `t()` so spoken strings are
  locale-aware.

## Settings

`AudioAlertSettings` includes master enable, global mute, voice/tone toggles,
volume, per-category mute flags, rate limits and battery/GPS thresholds. Settings
are mutable through `updateSettings`, `setGlobalMute` and `setCategoryMuted`.

## i18n

The module registers owned `audio.*` English messages at import time through
`registerMessages`; it does not modify i18n internals.
