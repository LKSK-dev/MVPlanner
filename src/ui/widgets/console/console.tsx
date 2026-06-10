/**
 * Scripting-console widget (task T7.4; spec plan/06 §6.7).
 *
 * A Solid view over the {@link ConsoleController}: a CodeMirror editor (with
 * `mvp.` autocomplete, history, top-level await) + a Run action, an output pane
 * that prints captured `console.*` output, the pretty-printed return value and
 * user-scoped errors, a user-controlled PERMISSION toggle list (the scripting
 * grant profile that decides which `mvp.*` surface exists), and a saved-snippet
 * list (run / load / delete).
 *
 * The editor mount is isolated in {@link mountConsoleEditor} and guarded: if the
 * host environment lacks the DOM APIs CodeMirror needs (e.g. a headless test
 * runner), the component falls back to a plain `<textarea>` so the controls
 * still render and the controller flow stays exercisable.
 */
import { For, Show, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import type { Permission } from '../../../contracts';
import { SCRIPTING_PERMISSIONS, type ScriptRunResult, type Snippet } from '../../../ext/scripting';
import { createMvpCompletionSource } from './completion';
import { type ConsoleEditorHandle, mountConsoleEditor } from './editor';
import './messages';
import type { ConsoleController } from './controller';
import type { TFn } from '../../../core/i18n';

/** i18n translate fn (matches the shell's `t`). */
export type { TFn };

/** Props for {@link ScriptingConsole}. */
export interface ScriptingConsoleProps {
  /** The controller wiring `makeContext` + storage + registry. */
  controller: ConsoleController;
  /** i18n translate fn. */
  t: TFn;
  /** Bundled `.d.ts` for autocomplete (from `buildExtApiDts()`); optional. */
  apiDts?: string;
  /** Initial editor contents. */
  initialCode?: string;
}

/** A single rendered output line. */
interface OutputLine {
  id: number;
  kind: 'log' | 'info' | 'warn' | 'error' | 'debug' | 'result' | 'fail' | 'note';
  text: string;
}

/** The scripting console view. */
export const ScriptingConsole: Component<ScriptingConsoleProps> = (props) => {
  const t = props.t;
  const [code, setCode] = createSignal(props.initialCode ?? '');
  const [output, setOutput] = createSignal<OutputLine[]>([]);
  const [running, setRunning] = createSignal(false);
  const [grants, setGrants] = createSignal<readonly Permission[]>([]);
  const [snippets, setSnippets] = createSignal<readonly Snippet[]>([]);
  const [snippetName, setSnippetName] = createSignal('');
  // Reactive so the textarea fallback hides once CodeMirror mounts.
  const [cmReady, setCmReady] = createSignal(false);

  let host: HTMLDivElement | undefined;
  let editor: ConsoleEditorHandle | undefined;
  let textarea: HTMLTextAreaElement | undefined;
  let seq = 0;

  const currentCode = (): string => editor?.getValue() ?? textarea?.value ?? code();

  const refreshGrants = async (): Promise<void> => {
    setGrants(await props.controller.grants.list());
  };
  const refreshSnippets = async (): Promise<void> => {
    setSnippets(await props.controller.snippets.list());
  };

  const push = (lines: OutputLine[]): void => {
    setOutput((prev) => [...prev, ...lines]);
  };

  const renderResult = (result: ScriptRunResult): void => {
    const lines: OutputLine[] = result.logs.map((entry) => ({
      id: seq++,
      kind: entry.level,
      text: entry.text,
    }));
    if (result.timedOut) {
      lines.push({
        id: seq++,
        kind: 'fail',
        text: t('console.output.timedOut', { ms: result.durationMs }),
      });
    } else if (result.error) {
      lines.push({
        id: seq++,
        kind: 'fail',
        text: t('console.output.error', { name: result.error.name, message: result.error.message }),
      });
    } else {
      lines.push({
        id: seq++,
        kind: 'result',
        text: t('console.output.returned', { value: result.valueText }),
      });
    }
    push(lines);
  };

  /** Render an infrastructure rejection (not a user-script error) visibly. */
  const renderFailure = (err: unknown): void => {
    const name = err instanceof Error ? err.name : 'Error';
    const message = err instanceof Error ? err.message : String(err);
    push([{ id: seq++, kind: 'fail', text: t('console.output.error', { name, message }) }]);
  };

  const run = async (): Promise<void> => {
    if (running()) return;
    setRunning(true);
    try {
      renderResult(await props.controller.run(currentCode()));
    } catch (err) {
      renderFailure(err);
    } finally {
      setRunning(false);
    }
  };

  const saveSnippet = async (): Promise<void> => {
    const name = snippetName().trim();
    if (!name) return;
    try {
      await props.controller.snippets.save({ name, code: currentCode() });
      setSnippetName('');
      await refreshSnippets();
    } catch (err) {
      renderFailure(err);
    }
  };

  const loadSnippet = (snippet: Snippet): void => {
    setCode(snippet.code);
    editor?.setValue(snippet.code);
    if (textarea) textarea.value = snippet.code;
  };

  const runSnippet = async (snippet: Snippet): Promise<void> => {
    try {
      renderResult(await props.controller.runSnippet(snippet.id));
    } catch (err) {
      renderFailure(err);
    }
  };

  const deleteSnippet = async (snippet: Snippet): Promise<void> => {
    await props.controller.snippets.remove(snippet.id);
    await refreshSnippets();
  };

  const toggleGrant = async (permission: Permission, on: boolean): Promise<void> => {
    setGrants(await props.controller.grants.toggle(permission, on));
  };

  onMount(() => {
    void refreshGrants();
    void refreshSnippets();
    if (host) {
      try {
        editor = mountConsoleEditor({
          parent: host,
          doc: code(),
          placeholder: t('console.editor.placeholder'),
          ...(props.apiDts ? { completionSource: createMvpCompletionSource(props.apiDts) } : {}),
          onRun: () => void run(),
          onChange: setCode,
        });
        setCmReady(true);
      } catch {
        // happy-dom / headless: CodeMirror needs DOM APIs we lack — fall back.
        editor = undefined;
        setCmReady(false);
      }
    }
  });

  onCleanup(() => editor?.destroy());

  return (
    <div class="mvp-console" role="group" aria-label={t('console.title')}>
      <div class="mvp-console__editor">
        <div class="mvp-console__cm" ref={host} />
        <Show when={!cmReady()}>
          <textarea
            class="mvp-console__textarea"
            ref={textarea}
            aria-label={t('console.title')}
            placeholder={t('console.editor.placeholder')}
            value={code()}
            onInput={(e): void => {
              setCode(e.currentTarget.value);
            }}
          />
        </Show>
      </div>

      <div class="mvp-console__toolbar">
        <button
          type="button"
          class="mvp-console__run"
          disabled={running()}
          onClick={(): void => void run()}
        >
          {running() ? t('console.running') : t('console.run')}
        </button>
        <button
          type="button"
          class="mvp-console__clear"
          onClick={(): void => {
            setOutput([]);
          }}
        >
          {t('console.clear')}
        </button>
        <input
          class="mvp-console__snippet-name"
          placeholder={t('console.snippets.namePlaceholder')}
          value={snippetName()}
          onInput={(e): void => {
            setSnippetName(e.currentTarget.value);
          }}
        />
        <button
          type="button"
          class="mvp-console__snippet-save"
          onClick={(): void => void saveSnippet()}
        >
          {t('console.snippets.save')}
        </button>
      </div>

      <div class="mvp-console__output" role="log" aria-live="polite">
        <Show
          when={output().length > 0}
          fallback={<p class="mvp-console__empty">{t('console.output.empty')}</p>}
        >
          <For each={output()}>
            {(line) => (
              <pre class={`mvp-console__line mvp-console__line--${line.kind}`}>{line.text}</pre>
            )}
          </For>
        </Show>
      </div>

      <details class="mvp-console__perms">
        <summary>{t('console.permissions.title')}</summary>
        <p class="mvp-console__hint">{t('console.permissions.hint')}</p>
        <For each={SCRIPTING_PERMISSIONS}>
          {(permission) => (
            <label class="mvp-console__perm">
              <input
                type="checkbox"
                checked={grants().includes(permission)}
                aria-label={t('console.permissions.toggle', { permission })}
                onChange={(e): void => void toggleGrant(permission, e.currentTarget.checked)}
              />
              {permission}
            </label>
          )}
        </For>
      </details>

      <details class="mvp-console__snippets">
        <summary>{t('console.snippets.title')}</summary>
        <Show
          when={snippets().length > 0}
          fallback={<p class="mvp-console__empty">{t('console.snippets.empty')}</p>}
        >
          <ul class="mvp-console__snippet-list">
            <For each={snippets()}>
              {(snippet) => (
                <li class="mvp-console__snippet">
                  <span class="mvp-console__snippet-title">{snippet.name}</span>
                  <button
                    type="button"
                    aria-label={t('console.snippets.run', { name: snippet.name })}
                    onClick={(): void => void runSnippet(snippet)}
                  >
                    {t('console.run')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('console.snippets.load', { name: snippet.name })}
                    onClick={(): void => loadSnippet(snippet)}
                  >
                    {t('console.snippets.load', { name: snippet.name })}
                  </button>
                  <button
                    type="button"
                    aria-label={t('console.snippets.delete', { name: snippet.name })}
                    onClick={(): void => void deleteSnippet(snippet)}
                  >
                    {t('console.snippets.delete', { name: snippet.name })}
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </details>
    </div>
  );
};
