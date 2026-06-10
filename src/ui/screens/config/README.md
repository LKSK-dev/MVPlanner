# `ui/screens/config` — Config screen assembly (M3 keystone)

The tabbed Config screen composing the two committed sub-panels. Spec:
plan/04 §4.5, plan/05 §5.4 Config. (App settings migrated to the App Settings
pane, `ui/shell/appsettings`, which also hosts its injectable models — the
Storage Manager and the Network section.)

## Tabs

| Tab        | Panel                              | Source module |
| ---------- | ---------------------------------- | ------------- |
| Parameters | `createParamWorkbenchPanel` (T3.4) | `./params`    |
| Tuning     | `createTuningPanel` (T3.6)         | `./tuning`    |

`ConfigScreen` mounts the sub-panels ONCE into hidden host containers and
toggles them by tab, so each panel's state (fetched params, staged edits)
survives tab switches. Only the active panel is visible.

## Shared singletons (wired in `App.tsx`)

The Parameters and Tuning tabs share **one** `ParamClient` + `ParamMetaStore` so
the parameter set is fetched once and reused. These (and a `presetStore`) are
constructed in `ui/screens/flight/services.ts` (`createFlightServices`) because
they are connection/app-scoped — they must survive screen switches like the
Flight services. `App` passes them, the `CommandClient`, the store and the
storage foundation into `createConfigScreenPanel` and installs the panel via
`setScreenPanel('config', …)`.

- **Param file Save/Load** (`ConfigScreen`) wires the workbench `onSave`/`onLoad`
  to `data/paramfile` (`saveParamFile`/`loadParamFile`); the sub-panels never
  import `data/paramfile`.
- **Storage Manager** (`register.tsx`) assembles `StorageManagerDeps` (from
  `ui/shell/appsettings`) over the storage foundation: tile-cache clear,
  `navigator.storage` estimate, factory reset (`storage.close()` +
  `indexedDB.deleteDatabase(DB_NAME)`) and a `saveAs` export.

## Tests

`test/unit/config-screen.test.ts` mounts `ConfigScreen` over mocks and asserts
the two tabs render + switch, and that the workbench Save/Compare route through
a mock `FileIo`. `test/unit/tuning-panel.test.ts` covers the Tuning tab and
`test/unit/flight-screen.test.ts`-style shell integration asserts navigating to
Config mounts the real screen.
