/**
 * Scripting-console controller (task T7.4; spec plan/06 §6.7).
 *
 * The TESTABLE orchestration core of the console, with NO editor/DOM dependency.
 * It is injected with `{ makeContext, storage, registry }` (per the task) and
 * wires the pure scripting layer:
 *  - `run(code)` builds `mvp = makeContext(grants)` for the current
 *    user-controlled grant profile and executes the script via the engine;
 *  - snippet / macro / grant stores are created over the injected KV store;
 *  - `runMacro` resolves a macro's inline code or its referenced snippet;
 *  - `bindSavedMacros` binds command/event macros to the registry / event bus.
 *
 * The CodeMirror view (`./editor`, `./console`) drives this controller; tests
 * drive it directly with fakes, so the whole flow is verifiable without an
 * editor.
 */
import type { ExtContext, KvStore, UiRegistry } from '../../../contracts';
import {
  type Macro,
  type MacroEventSource,
  type MacroStore,
  type ScriptRunResult,
  type ScriptingGrantStore,
  type ScriptingGrants,
  type SnippetStore,
  bindMacros,
  createMacroStore,
  createScriptingGrantStore,
  createSnippetStore,
  runScript,
} from '../../../ext/scripting';

/** Builds the `mvp` context for a user-controlled grant profile. */
export type MakeContext = (grants: ScriptingGrants) => ExtContext;

/** Injected dependencies for {@link createConsoleController}. */
export interface ConsoleControllerDeps {
  /** Build `mvp` for the supplied grant set (App wires this over the broker). */
  makeContext: MakeContext;
  /** KV store backing snippets / macros / grants. */
  storage: KvStore;
  /** Command palette registry — required to bind command-triggered macros. */
  registry?: Pick<UiRegistry, 'registerCommand'>;
  /** Optional event source for "run on event" macros. */
  events?: MacroEventSource;
  /** KV namespace (default `'scripting'`). */
  namespace?: string;
  /** Best-effort run timeout in ms. */
  timeoutMs?: number;
  /** Clock + id generator for deterministic tests. */
  now?: () => number;
  genId?: () => string;
}

/** The console's testable orchestration surface. */
export interface ConsoleController {
  /** Persisted named scripts. */
  readonly snippets: SnippetStore;
  /** Persisted macros. */
  readonly macros: MacroStore;
  /** User-controlled scripting permission profile. */
  readonly grants: ScriptingGrantStore;
  /** Run arbitrary code under the current grant profile. */
  run(code: string, opts?: { signal?: AbortSignal }): Promise<ScriptRunResult>;
  /** Run a saved snippet by id (rejects if missing). */
  runSnippet(id: string): Promise<ScriptRunResult>;
  /** Run a macro, resolving its inline code or referenced snippet. */
  runMacro(macro: Macro): Promise<ScriptRunResult>;
  /** Bind every saved, enabled macro to its trigger; returns a disposer. */
  bindSavedMacros(): Promise<() => void>;
}

/** Build a {@link ConsoleController} from injected deps. */
export function createConsoleController(deps: ConsoleControllerDeps): ConsoleController {
  const storeDeps = {
    storage: deps.storage,
    ...(deps.namespace !== undefined ? { namespace: deps.namespace } : {}),
  };
  const snippets = createSnippetStore({
    ...storeDeps,
    ...(deps.now ? { now: deps.now } : {}),
    ...(deps.genId ? { genId: deps.genId } : {}),
  });
  const macros = createMacroStore({
    ...storeDeps,
    ...(deps.genId ? { genId: deps.genId } : {}),
  });
  const grants = createScriptingGrantStore(storeDeps);

  const run = async (code: string, opts?: { signal?: AbortSignal }): Promise<ScriptRunResult> => {
    const granted = await grants.list();
    const mvp = deps.makeContext(granted);
    return runScript({
      code,
      mvp,
      ...(deps.timeoutMs !== undefined ? { timeoutMs: deps.timeoutMs } : {}),
      ...(deps.now ? { now: deps.now } : {}),
      ...(opts?.signal ? { signal: opts.signal } : {}),
    });
  };

  const resolveMacroCode = async (macro: Macro): Promise<string> => {
    if (macro.code !== undefined) return macro.code;
    if (macro.snippetId !== undefined) {
      const snippet = await snippets.get(macro.snippetId);
      if (snippet) return snippet.code;
    }
    return '';
  };

  const runMacro = async (macro: Macro): Promise<ScriptRunResult> =>
    run(await resolveMacroCode(macro));

  const runSnippet = async (id: string): Promise<ScriptRunResult> => {
    const snippet = await snippets.get(id);
    if (!snippet) throw new Error(`snippet "${id}" not found`);
    return run(snippet.code);
  };

  const bindSavedMacros = async (): Promise<() => void> => {
    if (!deps.registry) throw new Error('bindSavedMacros requires a registry');
    const all = await macros.list();
    return bindMacros(all, {
      registry: deps.registry,
      run: (macro) => {
        void runMacro(macro);
      },
      ...(deps.events ? { events: deps.events } : {}),
    });
  };

  return { snippets, macros, grants, run, runSnippet, runMacro, bindSavedMacros };
}
