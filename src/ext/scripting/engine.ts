/**
 * Scripting execution engine (task T7.4; spec plan/06 §6.7).
 *
 * PURE and editor-free: given a script string and an `mvp` {@link ExtContext},
 * it compiles the body into an async function (so TOP-LEVEL `await` and a
 * top-level `return` both work), injects `mvp` + a capturing `console`, runs it
 * with a best-effort timeout, and returns a {@link ScriptRunResult} carrying the
 * returned value (pretty-printed), the captured console output, and any error
 * with a user-scoped stack. Nothing here touches CodeMirror or the DOM, so the
 * engine is fully unit-testable with a mock `mvp`.
 *
 * The script runs in the MAIN realm (this is first-party USER scripting; the
 * `mvp` it receives is a brokered context built for a user-controlled scripting
 * grant profile — third-party code uses the Worker/iframe sandbox instead). The
 * timeout cannot interrupt a synchronous infinite loop in the main realm; it
 * resolves the run as timed-out while the offending microtask keeps running
 * (documented residual risk).
 */
import type { ExtContext } from '../../contracts';
import { formatValue, renderLogArgs } from './format';
import type { ConsoleLogEntry, ScriptError, ScriptRunResult } from './types';

/** Default run timeout (ms) — generous, since most scripts are short. */
export const DEFAULT_SCRIPT_TIMEOUT_MS = 10_000;

/** Filename embedded via `//# sourceURL` so user frames are recognisable. */
const SCRIPT_SOURCE_URL = 'mvp-script.js';

/** The capturing console handed to user scripts. */
interface ScriptConsole {
  log(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

/** Narrow type for the compiled user function (the only `Function` boundary). */
type CompiledScript = (mvp: ExtContext, console: ScriptConsole) => Promise<unknown>;
type AsyncFunctionCtor = new (...args: string[]) => CompiledScript;

/** The `AsyncFunction` constructor (not a global binding; derived once). */
const AsyncFunction = Object.getPrototypeOf(async function (): Promise<void> {
  /* probe */
}).constructor as AsyncFunctionCtor;

/** Outcome sentinels for the timeout/abort race. */
const TIMED_OUT = Symbol('timed-out');

/** Inputs for {@link runScript}. */
export interface RunScriptDeps {
  /** The user script source. */
  code: string;
  /** The `mvp` context exposed to the script. */
  mvp: ExtContext;
  /** Best-effort wall-clock timeout in ms (default {@link DEFAULT_SCRIPT_TIMEOUT_MS}); `0` disables. */
  timeoutMs?: number;
  /** Optional cancellation signal; aborting resolves the run as timed-out. */
  signal?: AbortSignal;
  /** Injectable clock for deterministic durations in tests. */
  now?: () => number;
}

/** Build a `console` that appends every call to `logs`. */
function makeCaptureConsole(logs: ConsoleLogEntry[]): ScriptConsole {
  const make =
    (level: ConsoleLogEntry['level']) =>
    (...args: unknown[]): void => {
      logs.push({ level, args, text: renderLogArgs(args) });
    };
  return {
    log: make('log'),
    info: make('info'),
    warn: make('warn'),
    error: make('error'),
    debug: make('debug'),
  };
}

/**
 * Trim an error stack to user frames (best-effort): keep the header line plus
 * any frames that reference {@link SCRIPT_SOURCE_URL}. When no user frames are
 * present (engine differences), the header alone is returned.
 */
export function scopeStack(
  stack: string | undefined,
  sourceUrl = SCRIPT_SOURCE_URL,
): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n');
  const header = lines[0] ?? '';
  const frames = lines.slice(1).filter((l) => l.includes(sourceUrl));
  return frames.length > 0 ? [header, ...frames].join('\n') : header;
}

/** Convert a thrown value into a {@link ScriptError} with a scoped stack. */
function toScriptError(thrown: unknown): ScriptError {
  if (thrown instanceof Error) {
    const scoped = scopeStack(thrown.stack);
    return {
      name: thrown.name,
      message: thrown.message,
      ...(scoped !== undefined ? { stack: scoped } : {}),
    };
  }
  return { name: 'Error', message: formatValue(thrown) };
}

/**
 * Run `deps.code` against `deps.mvp` and resolve a {@link ScriptRunResult}.
 * Never rejects: syntax errors, runtime throws and timeouts are all reported
 * through the result.
 */
export async function runScript(deps: RunScriptDeps): Promise<ScriptRunResult> {
  const now = deps.now ?? ((): number => Date.now());
  const timeoutMs = deps.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS;
  const logs: ConsoleLogEntry[] = [];
  const captureConsole = makeCaptureConsole(logs);
  const started = now();

  const finish = (partial: Omit<ScriptRunResult, 'logs' | 'durationMs'>): ScriptRunResult => ({
    ...partial,
    logs,
    durationMs: Math.max(0, now() - started),
  });

  // Compile: syntax errors surface here, synchronously.
  let compiled: CompiledScript;
  try {
    const body = `${deps.code}\n//# sourceURL=${SCRIPT_SOURCE_URL}`;
    compiled = new AsyncFunction('mvp', 'console', body);
  } catch (err) {
    return finish({
      ok: false,
      value: undefined,
      valueText: 'undefined',
      error: toScriptError(err),
      timedOut: false,
    });
  }

  // Race the user promise against the timeout / abort guard.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = new Promise<typeof TIMED_OUT>((resolve) => {
    const { signal } = deps;
    if (signal?.aborted) {
      resolve(TIMED_OUT);
      return;
    }
    if (signal) signal.addEventListener('abort', () => resolve(TIMED_OUT), { once: true });
    if (timeoutMs > 0) timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });

  type RunOutcome = { kind: 'value'; value: unknown } | { kind: 'error'; error: unknown };
  const run: Promise<RunOutcome> = (async (): Promise<RunOutcome> => {
    try {
      return { kind: 'value', value: await compiled(deps.mvp, captureConsole) };
    } catch (error) {
      return { kind: 'error', error };
    }
  })();

  try {
    const outcome = await Promise.race<RunOutcome | typeof TIMED_OUT>([run, guard]);
    if (outcome === TIMED_OUT) {
      return finish({
        ok: false,
        value: undefined,
        valueText: 'undefined',
        error: { name: 'TimeoutError', message: `script exceeded ${timeoutMs} ms` },
        timedOut: true,
      });
    }
    if (outcome.kind === 'error') {
      return finish({
        ok: false,
        value: undefined,
        valueText: 'undefined',
        error: toScriptError(outcome.error),
        timedOut: false,
      });
    }
    return finish({
      ok: true,
      value: outcome.value,
      valueText: formatValue(outcome.value),
      timedOut: false,
    });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
