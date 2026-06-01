# `ui/widgets/paramgrid` — parameter grid (T3.4)

Spec: `plan/04` §4.5 (full parameter management), `plan/05` §5.4 (Config) /
§5.5 (ParamGrid). The flagship, reusable parameter table.

## What it shows

- **Flat list** or **grouped tree** (group by the name prefix up to the first
  `_`, e.g. `ATC_*`, `RC1_*`). Toggle with the view buttons; groups collapse.
- **Fast search/filter** over parameter name **and** description.
- **Sortable** columns (name / value; click the header to toggle direction).
- A per-row **type-aware editor** driven by `ParamMeta`:
  | meta | editor |
  | --- | --- |
  | `bitmask` | checkboxes (one per bit, value = sum of set bits) |
  | `values` | enum dropdown (`value — label`) |
  | float `increment` / REAL32/REAL64 type | number input with `step` |
  | integer `MAV_PARAM_TYPE` | spinner (`step=1`) |
- **Units**, **range** (`min – max`), **reboot-required** indicator, and the
  **description** (info toggle + `title` tooltip).
- **Modified** rows (staged value differs from the vehicle) and **out-of-range**
  rows (vs `meta.min`/`max`) are highlighted with a non-color cue (icon + SR
  label) as well as color.

A large set still renders: the visible window is capped at `MAX_VISIBLE_ROWS`
(800) after filtering/sorting — narrow it with search. (Full virtualization is a
later optimisation; see "Residual risks".)

## Data contract (controlled component)

The grid owns **no** `ParamClient` and **no** values. The workbench injects:

```ts
interface ParamGridProps {
  rows: () => readonly Param[]; // base (vehicle) values
  pending: () => ReadonlyMap<string, number>; // staged edits name->value
  meta: ParamMetaResolver; // { get(name): ParamMeta | undefined }
  onEdit: (name: string, value: number) => void; // user edited a cell
  t: TFn;
  initialView?: 'flat' | 'tree';
}
```

`ParamMetaResolver` is satisfied structurally by
`src/mavlink/param-meta` `ParamMetaStore` (its `get`), or a one-method mock in
tests. Metadata resolution falls back to `param.meta` when the resolver misses.

## Pure helpers (unit-tested)

`model.ts`: `editorKindFor`, `groupPrefix`, `effectiveValue`, `isModified`,
`isOutOfRange`, `buildRows`, `filterRows`, `sortRows`, `groupRows`,
`parseEditorValue`, `hasBit`, `toggleBit`, `bitmaskEntries`, `enumEntries`,
`isIntegerParamType`. `diff.ts`: `computeDiff`, `toValueMap` (two-set compare for
the workbench drawer). All DOM-free.

## i18n

`params.*` grid strings register via `registerMessages` at import
(`messages.ts`) — never editing i18n internals. The workbench registers its own
disjoint `params.*` toolbar/diff keys.

## How to test

- `test/unit/paramgrid-model.test.ts` — the pure helpers (editor selection,
  grouping, filtering, modified/out-of-range, parsing, bitmask, diff).
- `test/unit/paramgrid-widget.test.ts` — the component over plain props: tree
  grouping, search filter, and edit float/int/enum/bitmask → `onEdit` + modified
  highlight + out-of-range highlight.

## Residual risks

- **Large-set rendering** is capped (window), not virtualized. 1–3k params
  render fine; a full ~1300-param ArduPilot set is well within the cap. A true
  windowing layer (e.g. on scroll) is a follow-up if profiling demands it.
