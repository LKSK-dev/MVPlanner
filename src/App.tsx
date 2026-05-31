import { createSignal, For, type Component } from 'solid-js';
import { t } from './core/i18n';
import { APP_VERSION } from './version';

/**
 * M0 placeholder shell. Demonstrates the build, theming, i18n, and routing
 * surface. The real dockable shell (top bar, command palette, dock manager,
 * alert center) is built in T0.7; the six screens are filled per-milestone.
 */
type ScreenId = 'flight' | 'plan' | 'setup' | 'config' | 'logs' | 'sim';
const SCREENS: ScreenId[] = ['flight', 'plan', 'setup', 'config', 'logs', 'sim'];

export const App: Component = () => {
  const [screen, setScreen] = createSignal<ScreenId>('flight');

  return (
    <div class="mvp-shell">
      <header class="mvp-topbar">
        <span class="mvp-brand">{t('app.name')}</span>
        <nav class="mvp-nav">
          <For each={SCREENS}>
            {(id) => (
              <button
                type="button"
                class="mvp-nav-item"
                aria-current={screen() === id ? 'page' : undefined}
                onClick={() => setScreen(id)}
              >
                {t(`nav.${id}`)}
              </button>
            )}
          </For>
        </nav>
        <span class="mvp-conn" title={t('conn.disconnected')}>
          ● {t('conn.disconnected')}
        </span>
      </header>

      <main class="mvp-main">
        <p class="mvp-placeholder">{t('screen.placeholder', { screen: t(`nav.${screen()}`) })}</p>
      </main>

      <footer class="mvp-footer">
        {t('app.tagline')} · v{APP_VERSION}
      </footer>
    </div>
  );
};
