/**
 * Shared scripting types (task T7.4; spec plan/06 §6.7).
 *
 * These describe the PURE scripting layer — the execution engine result, the
 * captured console output, and the persisted snippet / macro / grant shapes —
 * with no dependency on CodeMirror or the DOM, so the whole layer unit-tests
 * without an editor.
 */
import type { Permission } from '../../contracts';

/** A single captured `console.*` call from a script run. */
export interface ConsoleLogEntry {
  /** The console level used (`log` maps to `'log'`). */
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  /** The raw arguments passed to the console call. */
  args: readonly unknown[];
  /** Pre-rendered, single-string form of {@link args} for display. */
  text: string;
}

/** A user-code error, with the stack trimmed to user frames (best-effort). */
export interface ScriptError {
  /** The error constructor name (e.g. `'TypeError'`, `'Error'`). */
  name: string;
  /** The error message. */
  message: string;
  /** User-scoped stack (engine/internal frames stripped), when available. */
  stack?: string;
}

/** The result of running one script through {@link import('./engine').runScript}. */
export interface ScriptRunResult {
  /** True when the script completed without throwing (and within the timeout). */
  ok: boolean;
  /** The script's returned value (raw); `undefined` when it threw or returned nothing. */
  value: unknown;
  /** Pretty-printed form of {@link value} for the output pane. */
  valueText: string;
  /** Console output captured during the run, in order. */
  logs: readonly ConsoleLogEntry[];
  /** Present only when the script threw or timed out. */
  error?: ScriptError;
  /** Wall-clock duration of the run, in milliseconds. */
  durationMs: number;
  /** True when the run was aborted by the timeout / abort signal. */
  timedOut: boolean;
}

/** A persisted, named script. */
export interface Snippet {
  /** Stable id (slug or generated). */
  id: string;
  /** Human-facing name. */
  name: string;
  /** The script source. */
  code: string;
  /** Creation time (ms epoch). */
  createdMs: number;
  /** Last-update time (ms epoch). */
  updatedMs: number;
}

/** Fields accepted when creating / updating a {@link Snippet}. */
export interface SnippetInput {
  /** Provide to update an existing snippet; omit to create a new one. */
  id?: string;
  name: string;
  code: string;
}

/** The JSON envelope produced by snippet export / consumed by import. */
export interface SnippetsExport {
  kind: 'mvplanner.snippets';
  version: 1;
  snippets: Snippet[];
}

/** How a {@link Macro} is triggered. */
export type MacroTrigger =
  | { kind: 'command'; commandId: string; title: string; shortcut?: string }
  | { kind: 'event'; event: string }
  | { kind: 'button'; label: string };

/** A saved script bound to a trigger (command / event / button). */
export interface Macro {
  /** Stable id. */
  id: string;
  /** Human-facing name. */
  name: string;
  /** Reference to a {@link Snippet} whose code runs; mutually exclusive with {@link code}. */
  snippetId?: string;
  /** Inline code to run; used when {@link snippetId} is absent. */
  code?: string;
  /** What fires the macro. */
  trigger: MacroTrigger;
  /** Disabled macros are not bound. */
  enabled: boolean;
}

/** Fields accepted when creating / updating a {@link Macro}. */
export interface MacroInput {
  id?: string;
  name: string;
  snippetId?: string;
  code?: string;
  trigger: MacroTrigger;
  enabled?: boolean;
}

/** The JSON envelope produced by macro export / consumed by import. */
export interface MacrosExport {
  kind: 'mvplanner.macros';
  version: 1;
  macros: Macro[];
}

/** A grant profile: the permission set the user has enabled for the console. */
export type ScriptingGrants = readonly Permission[];
