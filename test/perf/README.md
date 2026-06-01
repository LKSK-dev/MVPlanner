# T8.10 perf harness

Opt-in Vitest suite for spec `plan/08` §8.1 and validation harness V3 (`plan/implementation/05-validation-and-ci.md` §5.1). It is intentionally **not** included by the root `npm test` unit config.

Run:

```sh
export npm_config_cache="$PWD/.npm-cache"
npx vitest run --config test/perf/vitest.config.ts
node scripts/size-report.mjs
```

## What it measures

- **MAVLink telemetry throughput:** builds a synthetic high-rate tlog (`HEARTBEAT`, `ATTITUDE`, `GLOBAL_POSITION_INT`, `SYS_STATUS` at 50 Hz cycles), parses it with `parseTlog`, feeds chunks through `MavlinkSession.pushBytes`, and prints messages/sec plus per-push and `takeSnapshot()` latency. The CI thresholds are generous and map the parser/coalescing work to the §8.1 telemetry→UI hard limit (150 ms); actual telemetry→paint and 60 fps HUD/map rendering remain browser perf coverage.
- **Large DataFlash `.bin` decode/query:** generates a tractable multi-MiB synthetic stream on the fly, decodes it with `DataFlashDecoder`, builds `LogQueryIndex` from an iterable of decoded records without retaining the input log or decoded row list, and prints decode throughput, index throughput, heap deltas, and first-query latency. This demonstrates the bounded streaming property for the 500 MB gate; true 500 MB browser render remains nightly/browser-deferred.
- **Size report:** checks `dist/MVPlanner.html` against the §8.1 5 MiB target / 8 MiB hard limit and prints bundled dialect JSON sizes.

## Tracked size optimization (not implemented here)

`common.json` is a subset of `ardupilotmega.json`, so bundling both creates about 270 KiB raw redundancy. Some MAVLink microservice constants import `commonDialect`; repointing those constants to an ardupilotmega-only built-in dialect would save that payload. T8.10 records the opportunity only because the current single-file artifact is within budget.
