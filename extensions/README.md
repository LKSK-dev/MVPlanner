# MVPlanner first-party example extensions

These `.mvpext.js` modules are living tutorials for the v1 `ctx` API. Each module exports a declarative `manifest`, an `activate(ctx)` function, and an optional `deactivate()`.

| Extension              | File                               | Permissions                                  | Demonstrates                                                               |
| ---------------------- | ---------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------- |
| Battery+ Panel         | `battery-plus.mvpext.js`           | `telemetry:read`, `ui:panel`, `notify`       | Panel registration, `SYS_STATUS` telemetry, low-battery notification.      |
| Geo-tagger             | `geo-tagger.mvpext.js`             | `telemetry:read`, `storage`                  | Camera-trigger handlers plus namespaced storage.                           |
| Param Diff & Presets   | `param-diff-presets.mvpext.js`     | `telemetry:read`, `params:write`, `ui:panel` | Panel + command contributions, parameter diffs, confirmable preset writes. |
| Custom NMEA/ADSB Layer | `custom-nmea-adsb-layer.mvpext.js` | `map`, `telemetry:read`                      | Map layer registration backed by MAVLink telemetry data.                   |
| Auto-test Script Pack  | `auto-test-script-pack.mvpext.js`  | `command`, `telemetry:read`                  | Safe SITL script sequencing triggered via `ctx.events`.                    |
| Field Night Theme Pack | `theme-pack.mvpext.js`             | `ui:panel`                                   | Theme token registration and teardown.                                     |
| Custom Transport Demo  | `custom-transport-demo.mvpext.js`  | `transport`                                  | No-op echo transport factory registration.                                 |

`index.js` exports all seven modules as `examples` for tests and in-app example browsers.
