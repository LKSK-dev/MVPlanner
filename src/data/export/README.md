# Data export (T6.7)

Pure, UI-agnostic helpers for CSV export and MAVLink tlog conversion.

## API

- `seriesToCsv(rows, columnsOrOptions?)` — serializes selected time-series rows to
  CSV with a header row, comma separators, and quote escaping for comma, quote,
  CR, and LF characters.
- `extractMessageStream(tlog, options?)` — parses a Mission Planner-compatible
  tlog via `transport/replay` and decodes each MAVLink frame with the built-in
  dialects (or supplied dialects), yielding decoded messages with tlog
  timestamps.
- `listTlogMessageTypes(tlog, options?)` — returns present message names, ids,
  counts, and observed fields for export pickers.
- `tlogToCsv(tlog, options?)` — default mode returns one CSV string per MAVLink
  message type; `mode: 'flat'` returns one selected-field CSV.
- `saveCsv(fileIo, name, csv)` — writes CSV text through the `FileIo` save seam.

The helpers intentionally avoid UI or storage dependencies beyond the `FileIo`
contract so they remain easy to unit test and safe to use from workers.
