/**
 * Scripting-console i18n strings (task T7.4; conventions plan/implementation/00
 * §0.3, spec plan/05 §5.9).
 *
 * The widget owns its `console.*` keys and contributes them at IMPORT TIME via
 * the public {@link registerMessages} seam — it never edits the central English
 * catalog or the i18n internals. Importing this module (the component + barrel
 * both do) makes `t('console.*')` resolve.
 */
import { registerMessages } from '../../../core/i18n';

/** The shipped English `console.*` strings. */
export const CONSOLE_MESSAGES: Readonly<Record<string, string>> = {
  'console.title': 'Scripting console',
  'console.panel.label': 'Console',
  'console.command.open': 'Open scripting console',
  'console.editor.placeholder': '// JavaScript — `mvp` is in scope; top-level await is allowed.',
  'console.run': 'Run',
  'console.running': 'Running\u2026',
  'console.clear': 'Clear output',
  'console.output.empty': 'No output yet. Write a script and Run it.',
  'console.output.returned': '\u21a9 {value}',
  'console.output.error': '{name}: {message}',
  'console.output.timedOut': 'Script timed out after {ms} ms.',
  'console.output.ok': 'Completed in {ms} ms.',
  'console.snippets.title': 'Snippets',
  'console.snippets.namePlaceholder': 'Snippet name\u2026',
  'console.snippets.save': 'Save snippet',
  'console.snippets.empty': 'No saved snippets.',
  'console.snippets.run': 'Run {name}',
  'console.snippets.load': 'Load {name}',
  'console.snippets.delete': 'Delete {name}',
  'console.snippets.export': 'Export snippets',
  'console.snippets.import': 'Import snippets',
  'console.macros.title': 'Macros',
  'console.macros.empty': 'No macros bound.',
  'console.permissions.title': 'Permissions',
  'console.permissions.hint': 'Toggle the API surface `mvp` exposes to your scripts.',
  'console.permissions.toggle': 'Toggle permission {permission}',
};

registerMessages(CONSOLE_MESSAGES);
