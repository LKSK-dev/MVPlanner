/**
 * Shell context: the dependency bundle every shell part and panel reads
 * (T0.7; spec plan/05 §5.2). Provided once at the {@link Shell} root and
 * consumed via {@link useShell}. The {@link PanelApi} (store + `t`) is the
 * frozen surface handed to imperatively-mounted panels (contract
 * `src/contracts/ui.ts`).
 */
import { createContext, useContext } from 'solid-js';
import type { AppState, PanelApi, Store } from '../../contracts';
import type { Capabilities } from '../../core/capabilities';
import type { KeybindRegistry } from '../../core/keybinds';
import type { ShellRegistry } from './registry';

/** Everything the shell tree needs, injected at the root for testability. */
export interface ShellContextValue {
  readonly store: Store<AppState>;
  readonly registry: ShellRegistry;
  readonly capabilities: Capabilities;
  readonly panelApi: PanelApi;
  /**
   * Optional live keybind registry. When present the shell's global keydown
   * dispatcher resolves chords → command ids through it (App Settings →
   * Keybinds). When absent the shell falls back to the built-in palette chord.
   */
  readonly keybinds?: KeybindRegistry;
}

const ShellContext = createContext<ShellContextValue>();

export { ShellContext };

/** Read the shell context. Throws when used outside a {@link Shell} provider. */
export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell: must be used within <Shell>');
  return ctx;
}
