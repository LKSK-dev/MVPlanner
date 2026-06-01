# Terrain elevation provider + profile (T4.8)

`geo/terrain` samples ground elevation from **Terrarium** RGB terrain tiles and
provides the pure profile / collision / terrain-frame math the Plan screen and
the TERRAIN microservice need. Spec: `plan/04` §4.3 (terrain following),
`plan/03` §3.4 (Terrain), `plan/07` §7.8 (offline terrain).

## Terrarium decode (`decode.ts`)

Terrarium packs metre elevation into 8-bit RGB:

```
elevation_m = (R · 256 + G + B / 256) − 32768
```

- `decodeTerrarium(r, g, b)` — the formula above (channels clamped to `[0,255]`).
  `R=128,G=0,B=0` ⇒ `0 m` (sea level); `B` is the sub-metre channel; the
  `−32768` bias carries bathymetry (negative) and high peaks in one triple.
- `elevationAtPixel(pixels, px, py)` — bounded read of a decoded `TilePixels`.
- `TileDecoder = (blob) => Promise<TilePixels>` — the decode seam.
  `createImageDecoder()` returns a browser decoder (`createImageBitmap` +
  `OffscreenCanvas`); `isImageDecoderAvailable()` feature-detects it. Tests and
  non-browser contexts inject their own decoder.

## Elevation provider (`provider.ts`)

`createElevationProvider({ tiles, decode, source?, zoom?, online?, maxDecodedTiles? })`

- `tiles` is any `TerrainTileSource` — the `geo/tiles` `TileCache` satisfies it
  structurally (cache-first; only fetches when `online`, default `true`).
- `source` defaults to `DEFAULT_TERRAIN_SOURCE`, a documented public Terrarium
  tileset (AWS "Terrain Tiles" open data, `…/terrarium/{z}/{x}/{y}.png`),
  user-overridable in Settings (T3.7). `zoom` defaults to `DEFAULT_TERRAIN_ZOOM`
  (12).
- `sampleElevation(lat, lon, zoom?)` — **bilinear** interpolation between the
  four surrounding tile pixels (pixel-centre convention). Resolves `undefined`
  (never throws) when the covering tile is unavailable (offline + uncached, fetch
  failure, decode error) — graceful offline per `plan/07` §7.8. Decoded tiles are
  memoised in a small bounded LRU.
- `pathProfile(points, spacingM)` — densifies the path (`samplePath`) and samples
  each point, returning `{ distanceM, elevationM }[]` (elevation `undefined`
  where unavailable) for the profile chart.

## Profile math (`profile.ts`) — pure, no I/O

- `samplePath(points, spacingM)` — even ≈`spacing` densification of a polyline
  with cumulative chainage; always includes both endpoints.
- `haversineMeters`, `offsetLatLon(origin, northM, eastM)` — great-circle
  distance and a metre→lat/lon offset (longitude scaled by `cos(lat)`).
- `aglToAmsl(agl, terrain)` / `amslToAgl(amsl, terrain)` — terrain-frame (AGL)
  ↔ AMSL via the ground elevation.
- `collisionCheck(points, minClearanceM)` — flags every `TerrainProfilePoint`
  whose `plannedAmslM` is within (or below) `minClearanceM` of `terrainM`,
  returning markers with the signed clearance.

## Testing

- `test/unit/terrain-decode.test.ts` — known RGB → elevation + pixel reads.
- `test/unit/terrain-provider.test.ts` — bilinear sampling against a mock
  ramp tile, decode memoisation, offline/decoder-error → `undefined`, and
  `pathProfile`.
- `test/unit/terrain-profile.test.ts` — `samplePath`, `offsetLatLon`,
  AGL↔AMSL, and `collisionCheck`.

> **Not here:** the TERRAIN microservice
> (`src/mavlink/microservices/terrain`) and the profile chart UI
> (`src/ui/screens/plan/terrain`) — both consume this module.
