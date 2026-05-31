# `geo/format` — coordinate formatting + parsing (T3.8)

Spec: `plan/05` §5.9 (i18n / coordinate formats).

Dependency-free, DOM-free WGS84 coordinate formatting for every frozen
`CoordinateFormat` (`'dd' | 'dms' | 'utm' | 'mgrs'`), plus parsing for the text
formats. Standard algorithms, no external dependency. Unit-tested — see
`test/unit/geo-format.test.ts`.

## API

- **`formatLatLon(lat, lon, format)`** — dispatch on `CoordinateFormat` with each
  format's defaults.
- **`parseLatLon(text, format?)`** — parse `'dd'`/`'dms'` (auto-detect when
  `format` is omitted); throws for `'utm'`/`'mgrs'` (not supported).

### Per-format

- **`dd.ts`** — decimal degrees: `formatDD` (signed or `N/S/E/W` hemisphere
  style) / `parseDD`. Canonical `.` decimal point so output round-trips.
- **`dms.ts`** — degrees/minutes/seconds: `formatDMS` (`38°57′33.84″N`) /
  `parseDMS`, with seconds-rounding carry so `60″`/`60′` never appear.
- **`utm.ts`** — `latLonToUtm` / `utmToLatLon` (Snyder series, WGS84,
  mm-accurate), `formatUTM`, `utmZone` (incl. Norway/Svalbard exceptions),
  `latBand`.
- **`mgrs.ts`** — `latLonToMgrs` / `formatMGRS`; 100 km square lettering follows
  the standard MGRS scheme with `I`/`O` skips. `accuracy` 1–5 digits (5 = 1 m).

## Conventions

`lat ∈ [-90, 90]`, `lon ∈ [-180, 180]`, degrees, WGS84. Hemisphere/band for UTM
follows the C–X latitude bands (≥ N is northern). Web-Mercator tile math lives
separately in `geo/tiles`.

## Reference points (validation)

- MGRS: `latLonToMgrs(48.24949, 16.41450)` → `33UXP0500444996` (zone 33U, Vienna
  area) — the canonical proj4/`mgrs` vector.
- UTM anchors: central meridian → easting `500000`; equator → northing `0`.
- Round-trip: `utmToLatLon(latLonToUtm(lat, lon)) ≈ (lat, lon)` to ~1e-7°.
