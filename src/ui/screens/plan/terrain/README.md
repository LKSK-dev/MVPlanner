# Terrain profile chart (T4.8)

The Plan-screen terrain profile: ground elevation (AMSL) vs distance along the
mission path, with the planned path altitude overlaid and collision / low-
clearance markers. Spec: `plan/04` §4.3 (terrain following), `plan/05` §5.3
(Plan).

## Component

```tsx
<TerrainProfile points={profilePoints} minClearanceM={10} t={api.t} />
```

`TerrainProfileProps`:

- `points: TerrainProfilePoint[]` — **injected** profile data
  (`{ distanceM, terrainM, plannedAmslM? }`). The async elevation sampling that
  produces it lives in `geo/terrain` (`ElevationProvider.pathProfile` + the
  mission's planned altitudes), so the component renders purely from data and
  unit-tests without a provider, map or network.
- `minClearanceM` (default `10`) — points whose planned altitude falls within (or
  below) this of the terrain are flagged via `geo/terrain` `collisionCheck`.
- `width` / `height` (default `600 × 200`), `t` (default the app `t`).

It renders an inline SVG: a filled **ground** polygon (`terrain-ground`), the
**planned** altitude polyline (`terrain-planned`, broken across points without a
planned altitude), red **markers** (`terrain-marker`) at collisions, and a status
chip — `terrain.collision.none` (OK) or `terrain.collision.warning` (an
`role="alert"` count). The empty state (`terrain-empty`) prompts for waypoints.

`register.tsx` exposes `createTerrainPanel({ points, minClearanceM? })` building
the dockable `plan.terrain` `PanelDef` (mounted by the Plan assembly, T4.10).

## i18n

`messages.ts` contributes the `terrain.*` namespace via the public
`registerMessages` seam (never editing i18n internals); importing the barrel
registers it once (idempotent).

## Testing

`test/unit/terrain-profile-chart.test.ts` mounts the component with injected
points: the empty state, the rendered ground + planned paths with an OK status,
and a colliding profile producing a marker + an `alert` warning status.

> **Not here:** the elevation provider/decode + profile math (`geo/terrain`) and
> the TERRAIN microservice (`mavlink/microservices/terrain`).
