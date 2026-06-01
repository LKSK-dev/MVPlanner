# `ui/screens/plan/map-edit` — Map mission editing (T4.4)

Spec: `plan/04` §4.3 (map editing). The map editor turns map clicks / drags into
edits of the **shared** plan models per the active tool, and renders the
editable geometry through the existing overlay layers.

## Tool modes (`PlanToolMode`)

`select` · `add-waypoint` · `draw-fence-polygon` · `draw-fence-circle` ·
`place-rally` · `draw-survey-polygon` · `measure`.

A click is reinterpreted per mode: append a NAV waypoint, append a vertex to the
active fence polygon, place/centre a fence circle, drop a rally point, extend the
survey polygon, or (for `select`/`measure`) do nothing. `select` additionally
grabs an existing feature on pointer-down for drag-to-move, and
Alt/Ctrl-click-deletes it.

## Pure reducer (`dispatch.ts`)

`dispatchMapEdit(state, mode, event) -> EditState` is the single, pure source of
truth — given the shared `EditState` bundle (mission / fence / rally / survey
polygon), the active mode and one `MapEditEvent` (`click` / `drag` / `delete` /
`set-fence-radius`), it returns a NEW bundle, never mutating its input. All
geometry edits compose the frozen `geo/*` model ops. `hitTest` (pure, given a
projection) finds the nearest draggable feature, and `toMissionOverlay` /
`toFenceOverlay` / `toRallyOverlay` map the models onto the existing layer
shapes.

## Controller (`controller.ts`)

`createMapEditController` binds the reducer to a live map engine: it routes
`engine.on('click')` through the reducer, registers the mission/fence/rally
overlay layers + a small survey-polygon layer, and — once `attach(surface)` is
called with the map DOM container — implements capture-phase pointer drag/delete
so it takes precedence over the map widget's pan. The reducer is unit-tested
(`test/unit/plan-map-edit.test.ts`); the canvas draw + pointer wiring are
canvas-deferred.
