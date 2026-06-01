# `geo/survey` — lawn-mower survey grid generator (T4.5)

Spec: `plan/04` §4.3 (Survey/Grid); work-breakdown `plan/implementation/03` §T4.5.

Dependency-free, DOM-free photogrammetry survey-grid generation. Given a survey
polygon plus a camera/overlap/altitude specification, produces ordered
boustrophedon (lawn-mower) sweep lines clipped to the polygon, the derived survey
estimates, and a `Mission` of `NAV_WAYPOINT` items. Pure and unit-tested — see
`test/unit/survey.test.ts`.

## API

- **`generateGrid(polygon, opts)` → `SurveyGrid`** — the entry point. Returns
  `{ waypoints, lines, estimates, altitudeM }`.
  - `opts.sensor`: a `SurveyCameraSpec` (`kind:'camera'`, with **exactly one** of
    `altitudeM` or `gsdM`) or a camera-less `SurveyDirectSpec` (`kind:'direct'`,
    footprint + GSD + altitude given directly).
  - `opts.frontlapPct` / `opts.sidelapPct`: overlaps in `[0, 100)`.
  - `opts.angleDeg`: sweep-line compass bearing (`0` = north). Default `0`.
  - `opts.speedMs`: ground speed for the time estimate. Default `10`.
  - `opts.entry` / `opts.exit`: optional waypoints bracketing the path.
- **`surveyToMission(grid, opts?)` → `Mission`** — converts the grid waypoints to
  `NAV_WAYPOINT` items at the survey altitude (frame relative-alt by default),
  optionally bracketed by `DO_SET_CAM_TRIGG_DIST` enable/disable items.
- **Camera math** (`camera.ts`): `gsdFromAltitude`, `altitudeFromGsd`,
  `groundFootprint`, `lineSpacingFromSidelap`, `triggerDistanceFromFrontlap`,
  `DEFAULT_CAMERA`.
- **Geometry** (`geometry.ts`): `polygonCentroid`, `toPlanar`/`toLatLon`,
  `polygonAreaM2` — exported for the UI overlay.

## Formulas

The `sensorWidthMm` axis is across-track (sidelap → line spacing); `sensorHeightMm`
is along-track (frontlap → trigger distance). mm units cancel:

```text
GSD            = sensorWidthMm · altitudeM / (focalLengthMm · imageWidthPx)   [m/px]
footprintWidth = GSD · imageWidthPx                                           [m]
footprintHeight= GSD · imageHeightPx                                          [m]
lineSpacing    = footprintWidth  · (1 − sidelap/100)                          [m]
triggerDist    = footprintHeight · (1 − frontlap/100)                         [m]
lineCount      = floor(acrossSpan / lineSpacing) + 1
photos/line    = floor(lineLen / triggerDist) + 1
pathLength     = Σ |wpᵢ − wpᵢ₊₁|        (lines + connectors)
duration       = pathLength / speed
coveredArea    = polygon area (shoelace)
```

## Geometry

Survey areas are small, so a local equirectangular tangent-plane projection
(centred on the polygon centroid) maps lat/lon ↔ metres. Sweep lines are
generated in a rotated `{along, across}` basis: lines of constant `across`
(spaced by line spacing, centred in the polygon) are intersected with the polygon
edges via a half-open scan-line rule, yielding `[uLo, uHi]` segments. A simple
polygon always produces an even crossing count, so **non-convex** polygons are
handled (each scan line can yield multiple segments). Lines are ordered
boustrophedon (every other line reversed) to minimise connector travel.

## Caveats

- Self-intersecting polygons are not supported (the even-crossing invariant
  assumes a simple polygon).
- Covered area is the polygon area, not the union of photo footprints.
- The tangent-plane projection is sub-metre accurate for typical survey extents
  (≲ few km); very large polygons accumulate projection error.
