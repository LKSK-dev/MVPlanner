# `ui/screens/plan/fence` — geofence editor (T4.6)

Spec: `plan/04` §4.3 (Geofence); `plan/05` §5.3 (Plan). Work-breakdown
`plan/implementation/03` §T4.6.

The Geofence editor panel. It manages the fence **shape list** (add/remove
inclusion/exclusion **polygons** and **circles**, toggle a shape's
inclusion/exclusion, edit circle **radius**) and the non-spatial **limits**
(min/max altitude + breach action). The fence model and the
`MISSION_TYPE_FENCE` conversion are pure and live in `geo/fence`; this module is
presentation + wiring only.

Polygon **vertex drawing** is owned by the map editor (T4.4): a polygon added
here starts empty and the row shows its vertex count. The current `Fence` is
reported through `onChange`, so the Plan assembly (T4.10) converts it
(`fenceToMission` + `fenceParams`) and uploads it via `MissionClient` / the
parameter service.

```tsx
<FencePanel onChange={(fence) => applyFence(fence)} />
```

## API

- **`FencePanel`** — the panel `Component`. Props: optional `initial: Fence`,
  `onChange(fence)`, optional `t`.
- **`createFencePanel(deps)` → `PanelDef`** — dockable panel (`plan.fence`)
  binding an optional `initial` fence + `onChange` callback.
- **`FENCE_PANEL_ID`**, **`FENCE_MESSAGES`**, **`registerFenceMessages`**.

## Testing

Mount `FencePanel` with a spy `onChange`; click the add buttons
(`data-testid="fence-add-incl-polygon"`, `fence-add-excl-circle`, …) to add
shapes, edit a circle radius (`fence-shape-radius`) or limits (`fence-min-alt`,
`fence-breach-action`), and remove a shape (`fence-shape-remove`), asserting the
emitted `Fence`. Importing the module registers the `fence.*` strings through the
public `registerMessages` seam (never the i18n internals).

## Owned files

`fence-panel.tsx` (component), `register.tsx` (panel glue), `messages.ts`
(`fence.*` i18n), `fence.css`, `index.ts`, `README.md`.
