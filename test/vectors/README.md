# MAVLink reference vectors (validation harness V1 / task T1.3)

These JSON files are the **independent ground-truth oracle** for the MAVLink
codec. They are generated from **pymavlink** (vendored in `./.venv`, version
recorded in `manifest.json`) and committed to the repo so CI can byte-compare the
project's TypeScript codec against them.

> **Independence rule:** nothing here depends on the project's own codec.
> pymavlink is the sole source of truth. The generator (`scripts/gen-vectors.py`)
> only emits + self-checks these vectors; it never imports `src/`. The shape
> test (`test/unit/vectors-shape.test.ts`) validates structure only. The
> codec-vs-vectors conformance runner is owned separately by task **T1.1**.

## Files

| File                  | Contents                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `vectors-v1.json`     | MAVLink **v1** frames (magic `0xFE`), unsigned.                                                |
| `vectors-v2.json`     | MAVLink **v2** frames (magic `0xFD`), unsigned, including a few `decodeOnly` truncated frames. |
| `vectors-signed.json` | MAVLink **v2 signed** frames (deterministic key/link/timestamp).                               |
| `manifest.json`       | Generator metadata, pymavlink version, signing params, per-file counts, and coverage summary.  |

## Record format

Each vector is one JSON object:

```jsonc
{
  "label": "heartbeat-gcs", // stable human id
  "dialect": "common", // "common" | "ardupilotmega"
  "msgName": "HEARTBEAT",
  "msgId": 0,
  "crcExtra": 50, // per-message CRC_EXTRA (from pymavlink)
  "version": 2, // 1 | 2 (framing version)
  "signed": false, // v2 message-signing applied?
  "sysid": 255,
  "compid": 0,
  "seq": 0,
  "fields": { "type": 6, "autopilot": 8, "base_mode": 0, "custom_mode": 0, "system_status": 4 },
  "expectedHex": "fd09000000ff00000000000000000608000403855c",

  // present only when "signed": true
  "signing": { "keyHex": "0001..1f", "linkId": 1, "timestamp": 1234567 },

  // present only on truncated decode-only v2 frames (see below)
  "decodeOnly": true,
  "truncatedPayloadLen": 30,
  "fullPayloadLen": 52,
  "note": "v2 payload truncated; decoder must zero-fill to the full field set",
}
```

`expectedHex` is the **complete on-the-wire frame** (header + payload + CRC, plus
the 13 signing bytes for signed v2). It is the byte string the codec's `encode`
must reproduce and the bytes its `parser` must decode into `fields`.

### Field value encoding (lossless JSON)

`fields` are the exact inputs passed to pymavlink's `<msg>_encode`, normalised to
be JSON-safe and lossless:

- **64-bit integers** (`uint64_t` / `int64_t`) are emitted as **decimal strings**
  to preserve precision beyond `Number.MAX_SAFE_INTEGER` (consumer should
  `BigInt(...)` them — matches the `bigint` arm of `FieldValue` in
  `src/contracts/mavlink.ts`).
- **`char[]` fields** are emitted as **strings** (textual content, no trailing
  NULs) — matches the `string` arm of `FieldValue`.
- **numeric array fields** are emitted as **JSON arrays of numbers** — matches
  the `number[]` arm of `FieldValue`.
- non-finite floats are emitted as the strings `"NaN"`, `"Infinity"`,
  `"-Infinity"`.
- all other scalars are plain JSON numbers.

> **v1 vs v2 extension fields.** v1 framing has no extension fields, so for
> messages that carry them (e.g. `GPS_RAW_INT`, `MEMINFO`) the **v1** record's
> `fields` omits the extension fields — exactly what a v1 peer sees. The v2
> record includes them.

### `decodeOnly` truncated vectors

MAVLink v2 trims trailing-zero bytes off the payload on send. The `decodeOnly`
records are v2 frames whose payload was truncated (`expectedHex` is shorter than
a full payload), while `fields` records the **full** field set including the
zeroed trailing fields. They exist to exercise **zero-fill on decode**: a parser
must expand the truncated payload back to the full field map. (Re-encoding them
would minimally re-truncate to the same bytes, hence "decode only".)

## Coverage

Representative set across `common` + `ardupilotmega`:

- Core messages: `HEARTBEAT`, `SYS_STATUS`, `GPS_RAW_INT`, `ATTITUDE`,
  `GLOBAL_POSITION_INT`, `COMMAND_LONG`, `COMMAND_INT`, `PARAM_VALUE`,
  `STATUSTEXT`, `MISSION_ITEM_INT`.
- v2 **extension** fields: `GPS_RAW_INT`, `MEMINFO` (ardupilotmega).
- numeric **array** fields: `GPS_STATUS` (`uint8[20]`).
- **char[]** fields, full-length and short: `PARAM_VALUE` (`char[16]`),
  `STATUSTEXT` (`char[50]`).
- Boundary/edge field values: min/max signed & unsigned ints, negatives, zeros,
  64-bit values, `NaN` params, full-length and short strings.

Every case is emitted as **both v1 and v2 (unsigned)**; a subset is also emitted
as **v2 signed**. See `manifest.json` → `counts` for the current totals.

## Regenerating

```sh
./.venv/bin/python scripts/gen-vectors.py
```

The generator is **self-validating**: for every emitted frame it independently
recomputes the CRC-16/MCRF4XX (with `CRC_EXTRA`), re-checks the v1/v2/signing
framing length, and parses the bytes back with pymavlink — aborting (non-zero
exit) if anything disagrees or if the required coverage set regresses.

After regenerating, run the shape test:

```sh
npx vitest run test/unit/vectors-shape.test.ts
```

> Do **not** hand-edit the JSON files — regenerate from the script so the bytes
> stay pymavlink-authoritative.
