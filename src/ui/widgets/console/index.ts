/**
 * `ui/widgets/console` public surface — the in-app scripting console (task T7.4;
 * spec plan/06 §6.7).
 *
 * A CodeMirror 6 editor (JavaScript, dark token theme, history, `mvp.`
 * autocomplete) + a Run action that executes the user's script in the main realm
 * with `mvp` = an {@link import('../../../contracts').ExtContext} built for a
 * user-controlled scripting permission profile. The pure execution engine +
 * snippet/macro/grant stores live in `src/ext/scripting`; this module is the
 * view + the injectable {@link createConsoleController} (`{ makeContext, storage,
 * registry }`).
 *
 * Cross-module consumers import from here, never deep paths (conventions
 * plan/implementation/00 §0.3). Importing this module registers the `console.*`
 * i18n strings as a side effect; mounting the widget also requires
 * `import './ui/widgets/console/console.css'` (integration step).
 *
 * @see ./README.md for the controller contract, what is pure-tested, and how to
 *   test.
 */
import './messages';

export { ScriptingConsole } from './console';
export type { ScriptingConsoleProps, TFn } from './console';
export { createConsoleController } from './controller';
export type { ConsoleController, ConsoleControllerDeps, MakeContext } from './controller';
export { mountConsoleEditor } from './editor';
export type { ConsoleEditorHandle, ConsoleEditorOptions } from './editor';
export { createMvpCompletionSource } from './completion';
export type { ConsoleCompletionSource } from './completion';
export {
  createScriptingConsolePanel,
  registerScriptingConsole,
  CONSOLE_PANEL_ID,
  CONSOLE_OPEN_COMMAND_ID,
} from './register';
export type { ScriptingConsoleOptions } from './register';
export { CONSOLE_MESSAGES } from './messages';
