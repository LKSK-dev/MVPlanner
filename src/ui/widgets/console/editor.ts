/**
 * CodeMirror 6 editor mount for the scripting console (task T7.4; spec plan/06
 * §6.7 "real code editor: syntax highlight, autocomplete, history, multi-line").
 *
 * This is the ONLY module that touches CodeMirror; the execution engine,
 * controller and stores are editor-free so they unit-test without a DOM. The
 * mount is deliberately thin and returns a small imperative handle the Solid
 * component drives. A dark theme is applied through design-token CSS variables
 * (with fallbacks) so it follows the active app theme.
 */
import { autocompletion, completionKeymap, type CompletionSource } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { javascript } from '@codemirror/lang-javascript';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, placeholder } from '@codemirror/view';

/** Options for {@link mountConsoleEditor}. */
export interface ConsoleEditorOptions {
  /** Container element the editor mounts into. */
  parent: HTMLElement;
  /** Initial document. */
  doc?: string;
  /** Placeholder shown when empty. */
  placeholder?: string;
  /** `mvp.` completion source (from {@link import('./completion').createMvpCompletionSource}). */
  completionSource?: CompletionSource;
  /** Fired on Mod-Enter (or the Run button via {@link ConsoleEditorHandle.getValue}). */
  onRun?: (code: string) => void;
  /** Fired on every document change. */
  onChange?: (code: string) => void;
}

/** Imperative handle returned by {@link mountConsoleEditor}. */
export interface ConsoleEditorHandle {
  /** Current document text. */
  getValue(): string;
  /** Replace the whole document. */
  setValue(code: string): void;
  /** Focus the editor. */
  focus(): void;
  /** Tear down the editor + listeners. */
  destroy(): void;
}

/** A dark, token-driven theme so the editor follows the app theme. */
const consoleTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--text, #e6e6e6)',
      backgroundColor: 'var(--surface-2, #1e1e1e)',
      fontSize: '13px',
      height: '100%',
    },
    '.cm-content': { fontFamily: 'var(--font-mono, ui-monospace, monospace)' },
    '.cm-gutters': {
      backgroundColor: 'var(--surface-1, #181818)',
      color: 'var(--text-dim, #888)',
      border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'var(--surface-3, #2a2a2a)' },
    '&.cm-focused': { outline: '1px solid var(--accent, #4a9eff)' },
  },
  { dark: true },
);

/** Mount a CodeMirror editor; throws if the host environment lacks the DOM APIs. */
export function mountConsoleEditor(opts: ConsoleEditorOptions): ConsoleEditorHandle {
  const runKeymap = keymap.of([
    {
      key: 'Mod-Enter',
      preventDefault: true,
      run: (view): boolean => {
        opts.onRun?.(view.state.doc.toString());
        return true;
      },
    },
  ]);

  const updateListener = EditorView.updateListener.of((update) => {
    if (update.docChanged) opts.onChange?.(update.state.doc.toString());
  });

  const extensions = [
    lineNumbers(),
    history(),
    javascript(),
    autocompletion(opts.completionSource ? { override: [opts.completionSource] } : {}),
    keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap, indentWithTab]),
    runKeymap,
    updateListener,
    consoleTheme,
    EditorView.lineWrapping,
    ...(opts.placeholder ? [placeholder(opts.placeholder)] : []),
  ];

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({ doc: opts.doc ?? '', extensions }),
  });

  return {
    getValue: (): string => view.state.doc.toString(),
    setValue: (code: string): void => {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: code } });
    },
    focus: (): void => view.focus(),
    destroy: (): void => view.destroy(),
  };
}
