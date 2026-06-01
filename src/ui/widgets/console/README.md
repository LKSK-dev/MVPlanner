# `ui/widgets/console` — scripting console (T7.4)

Spec: `plan/06` §6.7. The in-app scripting console/editor: a **CodeMirror 6**
editor + a Run action that executes the user's JavaScript against `mvp`, an
output pane (captured `console.*`, pretty-printed return value, user-scoped
errors), a user-controlled **permission** toggle list, and saved **snippets**.

The pure execution engine + snippet/macro/grant stores live in
`src/ext/scripting`; this module is the **view** plus the **injectable
controller**.

## Controller (testable, no editor)

```ts
const controller = createConsoleController({
  makeContext, // (grants) => ExtContext — App wires this over the T7.2 broker
  storage,     // KvStore (snippets / macros / grants)
  registry?,   // UiRegistry — required only for bindSavedMacros()
  events?,     // event source for "run on event" macros
  namespace?, timeoutMs?, now?, genId?,
});

await controller.run('return 1 + 1');     // builds mvp = makeContext(grants), runs
await controller.runSnippet(id);           // runs a saved snippet
await controller.runMacro(macro);          // resolves inline code or its snippet
const dispose = await controller.bindSavedMacros(); // binds command/event macros
controller.snippets / controller.macros / controller.grants; // the stores
```

`run()` resolves the **current grant profile** (`grants.list()`), calls
`makeContext(grants)` to get the `mvp` the script sees, then runs the engine. So
**which `mvp.*` surface exists is the user's choice** (toggled in the UI).

## Component

`ScriptingConsole(props)` — Solid component. Props:

- `controller` (required) — the `ConsoleController` above.
- `t` (required) — i18n translate fn.
- `apiDts?` — bundled `.d.ts` (`buildExtApiDts()`) for `mvp.` autocomplete.
- `initialCode?` — initial editor contents.

It mounts the CodeMirror editor via `mountConsoleEditor`. **The mount is
guarded**: if the host lacks the DOM APIs CodeMirror needs (e.g. a headless test
runner), it falls back to a `<textarea>` so the controls + controller flow still
work. `Mod-Enter` runs; the Run button runs the current editor contents.

## Editor (`mountConsoleEditor`)

The only module that touches CodeMirror. Returns an imperative handle
(`getValue` / `setValue` / `focus` / `destroy`). Uses `@codemirror/lang-javascript`,
history, line numbers, line wrapping, a `mvp.` completion source
(`createMvpCompletionSource(apiDts)` → wraps the pure `extractApiMembers`), and a
dark, **design-token-driven** theme (CSS `var(--…)` with fallbacks) so it follows
the active app theme.

## Registration glue

- `createScriptingConsolePanel(controller, t, opts?): PanelDef` — dockable panel
  (id `widget.console`).
- `registerScriptingConsole(registry, controller, t, opts?, openConsole?)` —
  registers the panel + an "Open scripting console" palette command
  (id `console.open`); returns a disposer.

## i18n

All strings route through `t()` under the `console.*` namespace, registered at
import via `registerMessages` (`./messages`) — never editing the central catalog.

## Integration note (not done here, per task boundary)

This widget does not edit `src/App.tsx` or any screen. App's wiring step is:
build `makeContext` from the T7.3 `assembleExtContext` (+ T7.2 broker) for the
`mvp.scripting.console` origin, `createConsoleController({ makeContext, storage,
registry, events })`, `registerScriptingConsole(registry, controller, t, {
apiDts: buildExtApiDts() })`, call `controller.bindSavedMacros()` once, and
`import './ui/widgets/console/console.css'`.

## How to test

- `test/unit/scripting-console.test.ts` — the controller over fakes: run under
  the grant profile, grant toggles flow into `makeContext`, snippet save/list/run,
  and a command-macro binding to the registry.
- `test/unit/scripting-editor.test.ts` — light component coverage (controls
  render, permission toggles reflect the grant store, Run prints output) + a
  **guarded** `mountConsoleEditor` smoke test.
