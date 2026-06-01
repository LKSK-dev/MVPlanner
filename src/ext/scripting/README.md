# `ext/scripting` — pure scripting layer (T7.4)

Spec: `plan/06` §6.7 (scripting console / REPL & editor). This module is the
**editor-free, unit-testable core** behind the in-app console
(`src/ui/widgets/console`). It has no CodeMirror or DOM dependency.

## What's here

| File            | Responsibility                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine.ts`     | The execution engine — compile a script to an async function, inject `mvp` + a capturing `console`, run with a best-effort timeout, return a `ScriptRunResult`. |
| `format.ts`     | `formatValue` / `renderLogArgs` — pretty-printing for returned values + `console.*` output.                                                                     |
| `snippets.ts`   | `createSnippetStore` — KV-backed named scripts + export/import.                                                                                                 |
| `macros.ts`     | `createMacroStore` + `bindMacros` — KV-backed macros and wiring them to commands / events.                                                                      |
| `grants.ts`     | The user-controlled scripting **permission profile** (`createScriptingGrantStore` + the permission lists).                                                      |
| `completion.ts` | `extractApiMembers` — best-effort `mvp.` member names parsed from the bundled `.d.ts`.                                                                          |
| `types.ts`      | Shared types (`ScriptRunResult`, `Snippet`, `Macro`, …).                                                                                                        |

## Execution engine (`runScript`)

```ts
const result = await runScript({ code, mvp, timeoutMs?, signal?, now? });
// result: { ok, value, valueText, logs, error?, durationMs, timedOut }
```

- The script body is compiled with the **`AsyncFunction`** constructor (the only
  `Function`-boundary in the module, narrowed to
  `(mvp, console) => Promise<unknown>`), so **top-level `await`** and a top-level
  `return` both work. A `//# sourceURL=mvp-script.js` marker makes user frames
  recognisable.
- `console.log/info/warn/error/debug` are **captured** into `result.logs` (never
  the host console), each rendered to `text` via `renderLogArgs`.
- The script runs in the **main realm** — this is first-party USER scripting; the
  `mvp` it receives is a brokered `ExtContext` built for a user-controlled
  scripting grant profile. Third-party extension code uses the Worker/iframe
  sandbox instead (T7.2).
- `runScript` **never rejects**: syntax errors, runtime throws and timeouts all
  come back through the result. Errors carry a **user-scoped stack**
  (`scopeStack` trims engine/internal frames).
- The timeout is **best-effort**: it resolves the run as `timedOut` but cannot
  interrupt a synchronous infinite loop in the main realm (see _Residual risks_).

## Permission profile (`grants.ts`)

The console exposes `mvp` under a grant set **the user controls** — toggling a
permission changes which `mvp.*` surface exists. Defaults are safe
(`telemetry:read`, `notify`, `storage`); everything vehicle-affecting
(`command` / `mavlink:send` / `params:write` / `mission:write`) and networking is
off until enabled. The grant set drives the `makeContext(grants)` the console UI
injects.

## How `mvp` / grants are injected

This layer never builds `mvp` itself. The console controller
(`src/ui/widgets/console/controller.ts`) is injected with
`makeContext: (grants) => ExtContext` (App wires it over the T7.2 broker +
T7.3 `assembleExtContext` for the `mvp.scripting.console` origin) and calls
`makeContext(await grants.list())` before each run.

## Snippets & macros

- `createSnippetStore({ storage, namespace?, now?, genId? })` — `save` (create or
  update), `list` (name-sorted), `get`, `remove`, `clear`, `export`/`import`
  (`{ kind: 'mvplanner.snippets', version: 1, snippets }`).
- `createMacroStore(...)` — same shape for macros (a macro = a name + a trigger +
  inline `code` or a `snippetId` reference).
- `bindMacros(macros, { registry, run, events? })` — binds **command**-triggered
  macros as palette `CommandDef`s, **event**-triggered macros via `events.on`,
  and leaves **button** macros to the UI. Returns a disposer.

## Autocomplete

`extractApiMembers(buildExtApiDts())` parses the **top-level** members of the
`ExtContext` interface out of the bundled `.d.ts` (relying on the generator's
stable 2-space indentation). The CodeMirror completion-source wrapper lives in
the console widget (UI layer).

## Tests

- `test/unit/scripting-engine.test.ts` — engine (return value, top-level await,
  console capture, thrown/syntax errors, timeout, abort) + `formatValue` +
  `scopeStack`.
- `test/unit/scripting-store.test.ts` — snippet/macro/grant stores +
  export/import + `bindMacros` + `extractApiMembers`.
- `test/unit/scripting-console.test.ts` — the controller (in the console widget).

## Residual risks

- **Synchronous infinite loops** (`while(true){}`) cannot be interrupted in the
  main realm; the timeout reports `timedOut` while the offending microtask keeps
  running. Long-running first-party scripts should `await`. Untrusted code must
  use the sandbox, not the console.
