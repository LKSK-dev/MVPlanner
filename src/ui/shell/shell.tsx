/**
 * The application shell root (T0.7; spec plan/05 §5.2/§5.3/§5.7).
 *
 * Composes the top bar, dockable workspace surface, command palette and alert
 * center over an injected {@link ShellContextValue}. Injecting the store,
 * registry and capabilities (rather than constructing them here) keeps the
 * shell unit-testable; {@link App} wires the real singletons.
 *
 * On creation the shell: applies settings → theme/locale, registers the six
 * screen placeholder panels and their navigation commands, registers the
 * palette + save-workspace commands, installs the ⌘/Ctrl-K shortcut, and (when
 * Web Serial is unsupported) shows a non-blocking capability notice.
 */
import { Show, createSignal, onCleanup, onMount, type Component } from 'solid-js';
import type { CommandDef, ScreenId } from '../../contracts';
import { t } from '../../core/i18n';
import { AlertCenter } from './alert-center';
import { CommandPalette } from './command-palette';
import { ShellContext, type ShellContextValue } from './context';
import { DockManager } from './dock';
import { createScreenPanels, SCREEN_ORDER } from './screens';
import { applySettingsEffects } from './settings-effects';
import { TopBar } from './topbar';
import { readShellLayout, saveWorkspaceAs, SHELL_LAYOUT_KEY } from './workspace';

/**
 * `sessionStorage` key recording that the Web Serial capability notice was
 * dismissed. Session-scoped on purpose: the notice stays hidden across
 * in-session reloads but returns on the next app launch (new session).
 */
const CAP_NOTICE_DISMISSED_KEY = 'mvp.shell.capNotice.dismissed';

/**
 * Read the session-scoped dismissed flag for the capability notice. Returns
 * `false` when `sessionStorage` is unavailable (private mode / SSR); the
 * in-memory signal then governs visibility for the current view.
 */
function readCapNoticeDismissed(): boolean {
  try {
    return (
      typeof sessionStorage !== 'undefined' &&
      sessionStorage.getItem(CAP_NOTICE_DISMISSED_KEY) === '1'
    );
  } catch {
    return false;
  }
}

/**
 * Persist the session-scoped dismissed flag. Best-effort: a thrown
 * `SecurityError` (private mode) is swallowed so dismissal still works
 * in-memory for the current view without crashing the shell.
 */
function persistCapNoticeDismissed(): void {
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(CAP_NOTICE_DISMISSED_KEY, '1');
    }
  } catch {
    // sessionStorage unavailable — the in-memory signal still hides the notice.
  }
}

/** Root shell component. All collaborators are injected via {@link ctx}. */
export const Shell: Component<{ ctx: ShellContextValue }> = (props) => {
  const { store, registry, capabilities } = props.ctx;
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const openPalette = (): void => {
    setPaletteOpen(true);
  };

  // Web Serial capability notice: dismissible for the current session.
  const [capNoticeDismissed, setCapNoticeDismissed] = createSignal(readCapNoticeDismissed());
  const dismissCapNotice = (): void => {
    persistCapNoticeDismissed();
    setCapNoticeDismissed(true);
  };

  applySettingsEffects(store);

  // --- register screens + navigation commands (disposed with the shell) ----
  const disposers: Array<() => void> = [];
  for (const panel of createScreenPanels()) disposers.push(registry.registerPanel(panel));

  const navigate = (screen: ScreenId): void =>
    store.patch((s) => {
      s.layout.activeScreen = screen;
    });

  for (const screen of SCREEN_ORDER) {
    const cmd: CommandDef = {
      id: `nav.${screen}`,
      title: t('cmd.goTo', { screen: t(`nav.${screen}`) }),
      run: () => navigate(screen),
    };
    disposers.push(registry.registerCommand(cmd));
  }

  disposers.push(
    registry.registerCommand({
      id: 'palette.open',
      title: t('cmd.openPalette'),
      shortcut: '⌘K',
      run: openPalette,
    }),
    registry.registerCommand({
      id: 'workspace.save',
      title: t('cmd.saveWorkspace'),
      run: () =>
        store.patch((s) => {
          const shell = readShellLayout(s.layout, t('workspace.default'));
          const saved = saveWorkspaceAs(shell, 'saved', t('workspace.default'));
          s.layout.workspaces[SHELL_LAYOUT_KEY] = saved;
        }),
    }),
  );

  // --- ⌘/Ctrl-K global shortcut -------------------------------------------
  const onKeyDown = (e: KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      setPaletteOpen((open) => !open);
    }
  };
  onMount(() => window.addEventListener('keydown', onKeyDown));
  onCleanup(() => {
    window.removeEventListener('keydown', onKeyDown);
    for (const dispose of disposers) dispose();
  });

  return (
    <ShellContext.Provider value={props.ctx}>
      <div class="mvp-shell">
        <TopBar onOpenPalette={openPalette} />

        <Show when={!capabilities.webSerial && !capNoticeDismissed()}>
          <div class="mvp-cap-notice" role="status" data-testid="cap-notice">
            <span class="mvp-cap-notice__text">
              <strong>{t('cap.serialUnsupported')}</strong> {t('cap.serialUnsupportedDetail')}
            </span>
            <button
              type="button"
              class="mvp-cap-notice__close"
              aria-label={t('cap.dismiss')}
              data-testid="cap-notice-dismiss"
              onClick={dismissCapNotice}
            >
              ×
            </button>
          </div>
        </Show>

        <main class="mvp-main">
          <DockManager />
        </main>

        <CommandPalette open={paletteOpen()} onClose={() => setPaletteOpen(false)} />
        <AlertCenter />
      </div>
    </ShellContext.Provider>
  );
};
