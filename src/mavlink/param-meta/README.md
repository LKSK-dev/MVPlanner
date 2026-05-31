# Parameter metadata (T3.3)

`ParamMetaStore` is the typed `ParamMeta` lookup that drives the parameter
workbench's metadata-driven editors (T3.4). Spec: `plan/04` §4.5 (units, ranges,
increments, enum dropdowns, bitmask checkboxes, reboot-required flags,
descriptions); `plan/03` §3.1 (dialect enums).

It answers, for a parameter name, the frozen
`ParamMeta` (`src/contracts/microservices.ts`):

```
units?  min?  max?  increment?
values?  (enum: value -> label)
bitmask? (bit index -> label)
rebootRequired?  description?
```

## Sources & precedence

Metadata is layered; **later sources override earlier ones field-by-field**
(an import never erases curated fields it does not itself provide):

1. **Curated embedded fallback** — `CURATED_PARAM_META` (`curated.ts`): ~45 of
   the most commonly edited ArduPilot params (rate/angle PIDs, `BATT_*`,
   `ARMING_CHECK`, `FS_*`, `WPNAV_*`, `RTL_ALT`, `FENCE_*`, `GPS_TYPE`,
   `FRAME_*`, `SERIAL1_*`, `RC1_*`, `FLTMODE1`, …) with units/range/enum/bitmask/
   reboot where well known. Compact, offline, not version-specific — so editors
   have hints out-of-the-box without any download.
2. **Dialect enrichment** (optional) — `enrichFromDialect(dialect, map)` fills a
   missing `values`/`bitmask` from a bundled `DialectTable`'s enums (power-of-two
   entries become bit indices). Never overrides existing maps.
3. **Runtime apm.pdef import** — `loadApmPdef(json)` parses a full per-firmware
   `apm.pdef.json` and merges it (authoritative). See below.

## Why apm.pdef is not bundled

The full ArduPilot parameter metadata (`apm.pdef.json`) is large and
**per-firmware/version**. Bundling every variant would bloat the single-file
app, which is a hard size budget (`plan/08` §8.1). Per spec §4.5 ("parameter
metadata fetched/embedded per firmware version") it is therefore **user/online
importable at runtime**: the caller fetches/loads the document (from the device,
disk, or an online index) and passes the parsed JSON to `loadApmPdef`. The
curated table covers the common offline case.

## apm.pdef.json parser

`parseApmPdef(json)` / `parseApmPdefParam(raw)` (`apm-pdef.ts`) implement the
canonical ArduPilot format. Tolerant of both top-level shapes:

- **vehicle-grouped**: `{ "json": {...}, "ArduCopter": { PARAM: {...} }, ... }`
- **flat**: `{ PARAM: {...}, PARAM2: {...} }`

Per-parameter fields → `ParamMeta`:

| apm.pdef field              | ParamMeta        | notes                                      |
| --------------------------- | ---------------- | ------------------------------------------ |
| `Units`                     | `units`          | trimmed string                             |
| `Range.low`/`.high`         | `min`/`max`      | string or number; also `"low high"`        |
| `Increment`                 | `increment`      |                                            |
| `Values`                    | `values`         | object `{ "0": "Label" }` or `"0:Label,…"` |
| `Bitmask`                   | `bitmask`        | bit index → label                          |
| `RebootRequired`            | `rebootRequired` | `"True"`/`"False"`/bool                    |
| `Description`/`DisplayName` | `description`    | `Description` preferred                    |
| `ReadOnly`, `User`          | —                | recognised, not in the frozen contract     |

## Lookup semantics

`get(name)` is **case-insensitive**. On an exact miss it tries common ArduPilot
instance numbering: the de-instanced name then instance 1 — e.g.
`BATT2_MONITOR` → `BATT_MONITOR`, `RC9_MIN` → `RC1_MIN`. Returns the stored
object (treat as read-only) or `undefined`.

## API

```
createParamMetaStore({ curated? })   -> ParamMetaStore   // seeds curated by default
new ParamMetaStore(seed?)            -> empty (or seeded) store

get(name)        -> ParamMeta | undefined   // case-insensitive + instance fallback
has(name)        -> boolean
size             -> number
set(name, meta)  -> void   // field-merge one param
merge(record)    -> void   // field-merge a name->ParamMeta record
loadApmPdef(json)-> number  // parse+merge a full apm.pdef.json; returns count
enrichFromDialect(dialect, map) -> number   // map: name -> { enum, bitmask? }
```

## Owned files

- `apm-pdef.ts` — pure apm.pdef.json parser.
- `curated.ts` — the compact `CURATED_PARAM_META` fallback table.
- `store.ts` — `ParamMetaStore`, `createParamMetaStore`, dialect enrichment.
- `index.ts` — public exports.

## Testing

`test/unit/param-meta.test.ts`: parse a sample apm.pdef snippet (vehicle-grouped

- flat) → correct `ParamMeta` (units/range/enum/bitmask/reboot, legacy comma
  Values); curated fallback returns metadata for common params (case-insensitive +
  instance fallback); `loadApmPdef` merge/override (import overrides curated fields,
  preserves the rest, adds new params); empty-store pure import; dialect
  enrichment fills missing maps without overriding; unknown param → `undefined`.

```
export npm_config_cache="$PWD/.npm-cache"
npx vitest run test/unit/param-meta*.test.ts
npx eslint src/mavlink/param-meta test/unit/param-meta*.test.ts
```

> **Not in scope here:** the parameter microservice fetch/set (T3.2), the
> workbench UI/editors (T3.4), and param file I/O / presets (T3.5). This module
> is pure metadata lookup.
