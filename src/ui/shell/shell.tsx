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

/** Root shell component. All collaborators are injected via {@link ctx}. */
export const Shell: Component<{ ctx: ShellContextValue }> = (props) => {
  const { store, registry, capabilities } = props.ctx;
  const [paletteOpen, setPaletteOpen] = createSignal(false);
  const openPalette = (): void => {
    setPaletteOpen(true);
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

        <Show when={!capabilities.webSerial}>
          <div class="mvp-cap-notice" role="status" data-testid="cap-notice">
            <strong>{t('cap.serialUnsupported')}</strong> {t('cap.serialUnsupportedDetail')}
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
