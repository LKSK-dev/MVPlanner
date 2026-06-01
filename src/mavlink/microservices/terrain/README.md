# TERRAIN microservice (T4.8)

`TerrainService` answers the vehicle's `TERRAIN_REQUEST` (msg 133) with
`TERRAIN_DATA` (msg 134) sourced from an injected elevation provider, and tracks
`TERRAIN_REPORT` (msg 136). Spec: `plan/03` §3.4 (**Terrain**).

## Contract

```
createTerrainService({ sendMessage, onMessage, elevation })

lastReport()        -> TerrainReport | undefined
blocksServed()      -> number              // TERRAIN_DATA sub-blocks sent
onReport(cb)        -> () => void
dispose()           -> void                // unsubscribe + drop listeners
```

- `sendMessage(name, fields)` and `onMessage(names, cb)` are **injected** (bound
  by the caller to the worker host's `sendMessage` / `onMessage`), so the service
  never imports the worker and is fully unit-testable. It taps
  `['TERRAIN_REQUEST', 'TERRAIN_REPORT']`.
- `elevation` is any `TerrainElevationSource` (`sampleElevation(lat, lon) =>
Promise<number | undefined>`); the `geo/terrain` `ElevationProvider` satisfies
  it. Serving is **best-effort** — send failures are swallowed (the vehicle
  re-requests unfilled blocks).

## Protocol grid (`grid.ts`)

Mirrors ArduPilot `AP_Terrain`. A `TERRAIN_REQUEST` names **one** `28 × 32`-post
grid block — south-west corner `lat`/`lon` (degE7), posts `grid_spacing` m apart
— and a 56-bit `mask` of which `4 × 4` sub-blocks it needs:

| constant              | value   | meaning                                      |
| --------------------- | ------- | -------------------------------------------- |
| `MAVLINK_GRID_SIZE`   | 4       | posts per side of a `TERRAIN_DATA` sub-block |
| `MUL_X` × `MUL_Y`     | 7 × 8   | sub-blocks per block (north × east)          |
| `BLOCK_SIZE_X` × `_Y` | 28 × 32 | posts per block                              |
| `MASK_BITS`           | 56      | mask bits (one per sub-block)                |
| `CELLS_PER_BLOCK`     | 16      | `int16` cells per `TERRAIN_DATA`             |

For sub-block bit `b` (`gridbitOrigin(b)`):

```
idxX = (b ÷ MUL_Y) · 4   // north (latitude) post offset of the sub-block
idxY = (b mod MUL_Y) · 4 // east  (longitude) post offset
```

The 16 heights are row-major `data[x·4 + y]` for `x` = north post `0…3` and
`y` = east post `0…3`, i.e. block post `(idxX + x, idxY + y)`, sampled at
`offsetLatLon(corner, (idxX+x)·spacing, (idxY+y)·spacing)`. Missing elevations
become the `TERRAIN_NODATA` (`-32768`) sentinel via `encodeElevation`.

## TERRAIN_REQUEST → TERRAIN_DATA flow

1. Decode `lat`/`lon` (degE7 → degrees corner), `grid_spacing`, `mask` (uint64).
   A non-positive spacing is ignored.
2. `maskBits(mask)` enumerates the set bits in ascending order.
3. For each bit, sample the 16 sub-block elevations (sequentially, to bound
   provider concurrency) and `sendMessage('TERRAIN_DATA', …)` with the **echoed**
   request corner (`lat`/`lon` degE7), `grid_spacing`, `gridbit`, and the 16
   `int16` `data` cells.

`TERRAIN_DATA` carries no target fields (it is addressed implicitly to the
requesting link), so no `getTarget` is needed — unlike the mission service.

## TERRAIN_REPORT

Decoded into `TerrainReport { lat, lon, terrainHeightM, currentHeightM,
spacingM, pending, loaded }`, stored as `lastReport()` and pushed to `onReport`
subscribers — the UI surfaces terrain-DB load progress + the autopilot's
under-vehicle AGL.

## Testing

`test/unit/terrain-service.test.ts` (mock host + mock provider): grid geometry
(`maskBits`, `gridbitOrigin`, `encodeElevation`); a single-bit request → one
structured `TERRAIN_DATA` with the expected `data[x·4 + y]` layout; one reply per
mask bit with the right `gridbit`; non-positive spacing ignored; unavailable
cells → no-data sentinel; no serving after `dispose`; `TERRAIN_REPORT` tracking.

> **Not here:** the elevation provider + decode (`geo/terrain`) and the profile
> chart UI (`ui/screens/plan/terrain`). SITL integration (serving real
> requests) is the milestone gate.
