/**
 * Top bar: brand, primary screen nav, vehicle status chips and the command
 * palette button (T0.7; spec plan/05 §5.2). Navigation drives the persisted
 * `layout.activeScreen`; status chips read the store reactively (telemetry
 * fields like armed/mode/battery arrive in M1/M2, so they render as neutral
 * placeholders here).
 */
import { For, type Component } from 'solid-js';
import type { ConnState, ScreenId } from '../../contracts';
import { t } from '../../core/i18n';
import { useShell } from './context';
import { useConnection } from './connection';
import { useAppSettings } from './appsettings/context';
import { SCREEN_ORDER } from './screens';

/** Map a {@link ConnState} to a catalog key for its chip label. */
function connKey(state: ConnState): string {
  return `conn.${state.kind === 'closed' ? 'closed' : state.kind}`;
}

/** The persistent application top bar. */
export const TopBar: Component<{ onOpenPalette: () => void }> = (props) => {
  const { store } = useShell();
  const connection = useConnection();
  const appSettings = useAppSettings();
  const activeScreen = store.select((s) => s.layout.activeScreen);
  const conn = store.select((s) => s.connection);

  const navigate = (screen: ScreenId): void => {
    store.patch((s) => {
      s.layout.activeScreen = screen;
    });
  };

  return (
    <header class="mvp-topbar">
      <button
        type="button"
        class="mvp-brand"
        data-testid="appsettings-open"
        aria-haspopup="dialog"
        aria-expanded={appSettings?.isOpen() ?? false}
        aria-controls="mvp-appsettings"
        aria-keyshortcuts="Control+, Meta+,"
        title={t('appsettings.open')}
        onClick={() => appSettings?.toggle()}
      >
        {t('shell.brand')}
      </button>

      <nav class="mvp-nav" aria-label={t('a11y.mainNav')}>
        <For each={SCREEN_ORDER}>
          {(id) => (
            <button
              type="button"
              class="mvp-nav-item"
              aria-current={activeScreen() === id ? 'page' : undefined}
              onClick={() => navigate(id)}
            >
              {t(`nav.${id}`)}
            </button>
          )}
        </For>
      </nav>

      <div class="mvp-status" role="group" aria-label={t('a11y.statusChips')}>
        <button
          type="button"
          class="mvp-chip mvp-chip--button"
          classList={{ 'mvp-chip--ok': conn().kind === 'open' }}
          aria-haspopup="dialog"
          title={t('cmd.connection')}
          onClick={() => connection?.openDrawer()}
        >
          <span class="mvp-chip__dot" aria-hidden="true" />
          {t(connKey(conn()))}
        </button>
        <span class="mvp-chip mvp-chip--muted">{t('status.disarmed')}</span>
        <span class="mvp-chip mvp-chip--muted">
          {t('status.mode')}: {t('status.unknown')}
        </span>
        <span class="mvp-chip mvp-chip--muted">
          {t('status.battery')} {t('status.unknown')}
        </span>
      </div>

      <button
        type="button"
        class="mvp-palette-btn"
        aria-keyshortcuts="Control+K Meta+K"
        title={t('topbar.openPalette')}
        onClick={() => props.onOpenPalette()}
      >
        <span aria-hidden="true">⌘K</span>
        <span class="mvp-visually-hidden">{t('topbar.openPalette')}</span>
      </button>
    </header>
  );
};
