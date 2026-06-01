# `ui/screens/plan/survey` — survey / grid config panel (T4.5)

Spec: `plan/04` §4.3 (Survey/Grid); `plan/05` §5.3 (Plan). Work-breakdown
`plan/implementation/03` §T4.5.

The Survey / grid configuration panel. It edits the **camera/sensor model**,
**overlap** (frontlap/sidelap), **altitude**, **grid angle** and **speed**, shows
the **live estimates** (GSD, line spacing, trigger distance, line/photo count,
area, path length, flight time), and has a **Generate** action. All survey math
is pure and lives in `geo/survey`; this module is presentation + wiring only.

The survey **polygon** is owned by the map editor (T4.4) and the resulting
**mission** is consumed by the mission model/service (T4.2/T4.1), so both are
**injected**:

```tsx
<SurveyPanel polygon={polygon()} onGenerate={(mission) => applyMission(mission)} />
```

## API

- **`SurveyPanel`** — the panel `Component`. Props: `polygon: LatLon[]`
  (`< 3` vertices disables Generate and shows a hint), `onGenerate(mission)`,
  optional `t` and `initial` (`Partial<SurveyConfig>`).
- **`createSurveyPanel(deps)` → `PanelDef`** — dockable panel (`plan.survey`)
  binding a `polygon()` provider + `onGenerate` callback.
- **`SURVEY_PANEL_ID`**, **`SURVEY_MESSAGES`**, **`registerSurveyMessages`**.

## Testing

Mount `SurveyPanel` with a fixed polygon and a spy `onGenerate`; assert the
estimates render and that clicking **Generate** (`data-testid="survey-generate"`)
calls back with a `Mission`. Importing the module registers the `survey.*`
strings; inputs carry `data-testid` hooks (`survey-altitude`, `survey-frontlap`,
`survey-est-lines`, …). i18n strings register through the public
`registerMessages` seam (never the i18n internals).

## Owned files

`survey-panel.tsx` (component), `register.tsx` (panel glue), `messages.ts`
(`survey.*` i18n), `survey.css`, `index.ts`, `README.md`.
