# Radio setup step (T5.6)

`createRadioStep(deps)` returns a Setup `SetupStep` for GCS-side RC calibration.

Dependencies:

- `calibration: Pick<CalibrationClient, 'radio'>` streams raw RC channel arrays.
- `params: Pick<ParamClient, 'set' | 'get'>` writes `RCn_MIN`, `RCn_MAX`, and `RCn_TRIM` and shows cached saved values when present.

Flow:

1. Start creates an `AbortController` and calls `calibration.radio(onChannels, signal)`.
2. Each channel array is folded through `accumulateRadioChannels`, which keeps per-channel current, min, max, sample count, and latest value as trim.
3. The pane renders accessible live meters plus a table of captured min/max/trim values.
4. Save builds `radioParamWrites(...)`, writes every active channel's `RCn_MIN/MAX/TRIM`, then aborts the stream and settles the step `done`.

The pure capture helpers are exported for unit tests and for future setup assembly reuse.
