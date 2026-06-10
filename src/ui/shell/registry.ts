/**
 * Shell {@link UiRegistry} implementation (T0.7; contract `src/contracts/ui.ts`,
 * spec plan/05 §5.5/§5.7).
 *
 * Holds the live set of panels, commands and menu items plus the transient
 * toast stack and the pending confirm request, all as Solid signals so the
 * shell UI reacts to registration and dismissal. The registry is created once
 * per app and exposed through the shell context; extensions (M7) and screens
 * register against this same surface.
 */
import { createSignal, type Accessor } from 'solid-js';
import type { CommandDef, ConfirmOptions, PanelDef, UiRegistry } from '../../contracts';

/** A queued toast notification (spec plan/05 §5.7 "Alert center"). */
export interface ShellToast {
  readonly id: number;
  readonly kind: 'info' | 'warn' | 'error';
  readonly msg: string;
}

/** A pending {@link UiRegistry.confirm} request awaiting user resolution. */
export interface ShellConfirmRequest {
  readonly id: number;
  readonly opts: ConfirmOptions;
  readonly resolve: (ok: boolean) => void;
}

/** A registered menu item, tagged with its target location. */
export interface ShellMenuItem {
  readonly location: string;
  readonly item: CommandDef;
}

/**
 * The shell registry: the frozen {@link UiRegistry} surface plus the reactive
 * accessors the shell UI reads to render.
 */
export interface ShellRegistry extends UiRegistry {
  readonly commands: Accessor<readonly CommandDef[]>;
  readonly panels: Accessor<readonly PanelDef[]>;
  getPanel(id: string): PanelDef | undefined;
  readonly menuItems: Accessor<readonly ShellMenuItem[]>;
  readonly toasts: Accessor<readonly ShellToast[]>;
  dismissToast(id: number): void;
  readonly confirmRequest: Accessor<ShellConfirmRequest | undefined>;
}

/** Auto-dismiss delay for non-error toasts (ms); errors persist until dismissed. */
const TOAST_TTL_MS = 6000;

/** Create the singleton shell registry. */
export function createUiRegistry(): ShellRegistry {
  const [panels, setPanels] = createSignal<readonly PanelDef[]>([]);
  const [commands, setCommands] = createSignal<readonly CommandDef[]>([]);
  const [menuItems, setMenuItems] = createSignal<readonly ShellMenuItem[]>([]);
  const [toasts, setToasts] = createSignal<readonly ShellToast[]>([]);
  const [confirmRequest, setConfirmRequest] = createSignal<ShellConfirmRequest | undefined>();

  let nextId = 1;
  const id = (): number => nextId++;

  // Pending auto-dismiss timers, keyed by toast id, so a manual dismiss can
  // cancel the timeout instead of letting it fire on an already-removed toast.
  const toastTimers = new Map<number, ReturnType<typeof setTimeout>>();

  const dismissToast = (toastId: number): void => {
    const timer = toastTimers.get(toastId);
    if (timer !== undefined) {
      clearTimeout(timer);
      toastTimers.delete(toastId);
    }
    setToasts((list) => list.filter((tch) => tch.id !== toastId));
  };

  const registry: ShellRegistry = {
    registerPanel(def: PanelDef): () => void {
      setPanels((list) => [...list.filter((p) => p.id !== def.id), def]);
      return () => setPanels((list) => list.filter((p) => p.id !== def.id));
    },
    registerCommand(def: CommandDef): () => void {
      setCommands((list) => [...list.filter((c) => c.id !== def.id), def]);
      return () => setCommands((list) => list.filter((c) => c.id !== def.id));
    },
    addMenuItem(location: string, item: CommandDef): () => void {
      const entry: ShellMenuItem = { location, item };
      setMenuItems((list) => [...list, entry]);
      return () => setMenuItems((list) => list.filter((m) => m !== entry));
    },
    toast(kind: 'info' | 'warn' | 'error', msg: string): void {
      const toastId = id();
      setToasts((list) => [...list, { id: toastId, kind, msg }]);
      if (kind !== 'error') {
        toastTimers.set(
          toastId,
          setTimeout(() => dismissToast(toastId), TOAST_TTL_MS),
        );
      }
    },
    confirm(opts: ConfirmOptions): Promise<boolean> {
      return new Promise<boolean>((resolve) => {
        // A second concurrent confirm replaces the first: resolve the pending
        // request with `false` so its caller never hangs (audit D1).
        const pending = confirmRequest();
        if (pending !== undefined) pending.resolve(false);
        const requestId = id();
        setConfirmRequest({
          id: requestId,
          opts,
          resolve: (ok: boolean) => {
            setConfirmRequest(undefined);
            resolve(ok);
          },
        });
      });
    },
    commands,
    panels,
    getPanel(panelId: string): PanelDef | undefined {
      return panels().find((p) => p.id === panelId);
    },
    menuItems,
    toasts,
    dismissToast,
    confirmRequest,
  };

  return registry;
}
