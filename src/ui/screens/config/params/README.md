# `ui/screens/config/params` — parameter workbench (T3.4)

Spec: `plan/04` §4.5 (full parameter management), `plan/05` §5.4 (Config).
The workbench wires the reusable `ParamGrid` (`src/ui/widgets/paramgrid`) to the
parameter microservice + a toolbar and a compare/diff drawer.

## What it does

- **Fetch / Refresh** the complete parameter set with a **progress bar** driven
  by `ParamClient.fetchAll`'s `onProgress(done, total)`.
- **Write changed** — calls `client.set(name, value)` **only** for the
  staged-modified parameters (the diff against the fetched base).
- **Write all** — writes every parameter's effective value.
- **Save to file** / **Compare / diff** — **injected callbacks** (see below).
- A **compare/diff drawer** comparing the current effective values against a
  loaded _other_ set (file or another vehicle): `name / current / other / Δ`.

The workbench owns the fetched param set + a staged-edit buffer; the grid stays
a pure controlled view. `ParamClient.onChange` folds vehicle-confirmed values
back into the base set (and clears a now-matching staged edit).

## Injection seams (how the Config assembly wires it)

```ts
createParamWorkbenchPanel({
  client, // ParamClient    — src/mavlink/microservices/param
  meta, // ParamMetaStore — src/mavlink/param-meta (its `get`)
  t, // i18n
  onSave, // (params: Param[]) => void|Promise — wired to T3.5 paramfile
  onLoad, // () => Promise<Param[] | Record<string,number>> — T3.5 / vehicle
});
```

- `client` + `meta` are injected so the panel is testable with mocks (no Worker,
  no host). The Config screen owns the singletons and passes the real ones.
- `onSave` / `onLoad` are the **only** file seam: this module does **not** import
  `src/data/paramfile` (T3.5). The Config assembly binds them to the param-file
  load/save + presets, or to "another vehicle" for a vehicle-vs-vehicle diff.
- The `Save` / `Compare` toolbar buttons are hidden when the matching callback is
  absent.

The panel id is `config.params` (`PARAM_WORKBENCH_PANEL_ID`).

## i18n

`params.*` toolbar/diff strings register via `registerMessages` at import
(`messages.ts`); the grid registers its own disjoint `params.*` keys. i18n
internals are never edited.

## How to test

- `test/unit/param-workbench.test.ts` — mounts `ParamWorkbench` over a **mock
  `ParamClient`** (returns a param set, records `set()` calls + progress) and a
  **mock `ParamMetaResolver`**:
  - Fetch populates the grid and drives the progress bar.
  - Editing marks a row modified; **Write changed** calls `set()` only for the
    modified param.
  - The compare drawer computes deltas vs an injected _other_ set.

The grid's own search / grouping / editor / out-of-range behaviour is covered by
`test/unit/paramgrid-widget.test.ts` and `test/unit/paramgrid-model.test.ts`.
