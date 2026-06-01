# `ui/screens/plan/rally` — rally points editor (T4.7)

Spec: `plan/04` §4.3 (Rally points); `plan/05` §5.3 (Plan). Work-breakdown
`plan/implementation/03` §T4.7.

The Rally points editor. It manages a `Rally` model — a list of rally points
with **add / remove / edit** of the numeric fields (lat/lon/alt plus optional
break altitude and landing direction) and a default altitude for new points. All
rally math (and the `Rally ↔ MISSION_TYPE_RALLY` mapping) is pure and lives in
`geo/rally`; this module is presentation + wiring only.

Map placement of points is owned by the map editor (T4.4); the resulting
**rally model** is consumed by the Plan assembly, which serialises it via
`geo/rally` `rallyToMission` and uploads it through the `MissionClient`. So the
value and the edit sink are **injected**:

```tsx
<RallyPanel value={rally()} onChange={(next) => applyRally(next)} />
```

## API

- **`RallyPanel`** — the panel `Component`. Props: `value?: Rally` (default an
  empty rally set), `onChange?(rally)`, optional `t`.
- **`createRallyPanel(deps)` → `PanelDef`** — dockable panel (`plan.rally`)
  binding an optional `value()` provider + `onChange` callback.
- **`RALLY_PANEL_ID`**, **`RALLY_MESSAGES`**, **`registerRallyMessages`**.

## Testing

Mount `RallyPanel` with a spy `onChange`; click **Add** (`data-testid="rally-add"`)
to append a point, edit a field (`rally-lat-0`, `rally-alt-0`,
`rally-break-alt-0`, …) and assert `onChange` receives the updated `Rally`, and
click **Remove** (`rally-remove-0`) to drop it. Clearing the optional break-alt /
land-dir inputs removes the field from the point. Importing the module registers
the `rally.*` strings through the public `registerMessages` seam (never the i18n
internals).

## Owned files

`rally-panel.tsx` (component), `register.tsx` (panel glue), `messages.ts`
(`rally.*` i18n), `rally.css`, `index.ts`, `README.md`.
