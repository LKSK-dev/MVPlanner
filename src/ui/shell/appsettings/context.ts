/**
 * App Settings pane context (spec docs/appsettings §3/§7). Provides open/close/
 * toggle + active-section state to the brand trigger, the pane and the global
 * command/keybind. Mirrors the connection-drawer context pattern.
 */
import { createContext, createSignal, useContext, type Accessor } from 'solid-js';
import type { AppState, ConfirmOptions, FileIo, Store, UiRegistry } from '../../../contracts';
import type { KeybindRegistry } from '../../../core/keybinds';
import type { RecentEntry, RecentsStore } from '../../../core/recents';
import type { StorageManagerDeps } from '../../screens/config/settings/storage-manager';
import type { NetworkSectionDeps } from '../../screens/config/settings/network';
import type { ExtensionsController } from '../../screens/sim';

/** i18n translate function. */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Safety-confirm seam (the shell `UiRegistry.confirm`). */
export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

/** Shared dependencies passed to every App Settings section. */
export interface AppSettingsSectionDeps {
  /** The app store (settings source + write target). */
  readonly store: Store<AppState>;
  /** i18n translate function. */
  readonly t: TFn;
  /** File picker I/O (theme/settings bundle import/export, recents re-open). */
  readonly files: FileIo;
  /** Recents store (recents section + cross-screen recording). */
  readonly recents: RecentsStore;
  /**
   * Open a recent item end-to-end (navigate to the right screen + load its
   * cached content). Wired by the App; absent in isolated tests. When omitted,
   * the Recents section degrades to list/remove/clear only.
   */
  readonly openRecent?: (entry: RecentEntry) => void | Promise<void>;
  /** Live keybind registry (keybinds section + global dispatcher). */
  readonly keybinds: KeybindRegistry;
  /** Persist keybind overrides back to `settings.keybinds`. */
  readonly persistKeybinds: () => void;
  /** Storage Manager handles (usage/clear/factory-reset). Optional. */
  readonly storage?: StorageManagerDeps;
  /** Safety-confirm seam. */
  readonly confirm?: ConfirmFn;
  /** Network egress-transparency sources. Optional. */
  readonly network?: NetworkSectionDeps;
  /** UI registry (open the About panel / palette commands). */
  readonly registry: UiRegistry;
  /**
   * Shared extensions-manager controller (same instance the Sim hub drives), so
   * the Extensions section's install/enable/disable/grant actions stay in sync.
   * Absent in isolated tests / when no extension system is wired.
   */
  readonly extensions?: ExtensionsController;
  /** Switch the active section. */
  readonly setSection: (id: string) => void;
  /** Close the pane. */
  readonly close: () => void;
}

/** A registered App Settings section. */
export interface AppSettingsSection {
  /** Stable section id (persisted as `appearance.lastSettingsSection`). */
  readonly id: string;
  /** i18n label key for the rail. */
  readonly labelKey: string;
  /** Renders the section body. */
  readonly render: (deps: AppSettingsSectionDeps) => unknown;
}

/** Pane control surface exposed via context. */
export interface AppSettingsContextValue {
  readonly isOpen: Accessor<boolean>;
  readonly section: Accessor<string>;
  open(section?: string): void;
  close(): void;
  toggle(): void;
  setSection(id: string): void;
}

const AppSettingsContext = createContext<AppSettingsContextValue>();

/** Create the pane control state. `initialSection` seeds the active section. */
export function createAppSettingsControl(initialSection: string): AppSettingsContextValue {
  const [isOpen, setOpen] = createSignal(false);
  const [section, setSectionSig] = createSignal(initialSection);
  return {
    isOpen,
    section,
    open(next?: string): void {
      if (next !== undefined) setSectionSig(next);
      setOpen(true);
    },
    close(): void {
      setOpen(false);
    },
    toggle(): void {
      setOpen((v) => !v);
    },
    setSection(id: string): void {
      setSectionSig(id);
    },
  };
}

export { AppSettingsContext };

/** Access the App Settings pane control, or `undefined` outside the provider. */
export function useAppSettings(): AppSettingsContextValue | undefined {
  return useContext(AppSettingsContext);
}
