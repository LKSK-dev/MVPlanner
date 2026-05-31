/**
 * UI extension-point seams (impl 02 §2.6; spec plan/05 §5.5, plan/06 §6.4). FROZEN.
 */
import type { AppState, Store } from './store';

export interface PanelApi {
  store: Store<AppState>;
  t: (k: string, vars?: Record<string, string | number>) => string;
}

export interface PanelDef {
  id: string;
  title: string;
  icon?: string;
  /** Returns an optional disposer. */
  mount(el: HTMLElement, api: PanelApi): void | (() => void);
}

export interface CommandDef {
  id: string;
  title: string;
  shortcut?: string;
  run(): void | Promise<void>;
}

export interface ConfirmOptions {
  title: string;
  body: string;
  destructive?: boolean;
  /** Strengthen confirmation when armed/in-air (spec plan/08 §8.3). */
  armedAware?: boolean;
}

export interface UiRegistry {
  registerPanel(def: PanelDef): () => void;
  /** Command palette (spec plan/05 §5.7). */
  registerCommand(def: CommandDef): () => void;
  addMenuItem(location: string, item: CommandDef): () => void;
  toast(kind: 'info' | 'warn' | 'error', msg: string): void;
  confirm(opts: ConfirmOptions): Promise<boolean>;
}
