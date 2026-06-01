/**
 * `ext/scripting` public surface — the PURE scripting layer behind the in-app
 * console (task T7.4; spec plan/06 §6.7).
 *
 * Everything here is editor-free and unit-testable:
 *  - {@link runScript} — the execution engine (compile to an async function so
 *    top-level `await`/`return` work, inject `mvp` + a capturing `console`,
 *    timeout, user-scoped errors);
 *  - {@link createSnippetStore} / {@link createMacroStore} — KV-backed named
 *    scripts + macros with export/import;
 *  - {@link bindMacros} — wires macros to commands (registry) / events;
 *  - {@link createScriptingGrantStore} — the user-controlled permission profile
 *    driving `makeContext(grants)`;
 *  - {@link extractApiMembers} — best-effort `mvp.` autocomplete from the `.d.ts`.
 *
 * The CodeMirror view + the controller that injects `{ makeContext, storage,
 * registry }` live in `src/ui/widgets/console`. Cross-module consumers import
 * from here, never deep paths (conventions plan/implementation/00 §0.3).
 */
export { runScript, scopeStack, DEFAULT_SCRIPT_TIMEOUT_MS } from './engine';
export type { RunScriptDeps } from './engine';
export { formatValue, renderLogArgs } from './format';
export { createSnippetStore } from './snippets';
export type { SnippetStore, SnippetStoreDeps } from './snippets';
export { createMacroStore, bindMacros } from './macros';
export type { MacroStore, MacroStoreDeps, BindMacrosDeps, MacroEventSource } from './macros';
export {
  createScriptingGrantStore,
  SCRIPTING_EXT_ID,
  SCRIPTING_PERMISSIONS,
  DEFAULT_SCRIPTING_GRANTS,
} from './grants';
export type { ScriptingGrantStore, ScriptingGrantStoreDeps } from './grants';
export { extractApiMembers } from './completion';
export type { ApiMember } from './completion';
export type {
  ConsoleLogEntry,
  ScriptError,
  ScriptRunResult,
  Snippet,
  SnippetInput,
  SnippetsExport,
  Macro,
  MacroInput,
  MacroTrigger,
  MacrosExport,
  ScriptingGrants,
} from './types';
