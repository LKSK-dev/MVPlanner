/**
 * Top bar: brand, primary screen nav, vehicle status chips and the command
 * palette button (T0.7; spec plan/05 §5.2). Navigation drives the persisted
 * `layout.activeScreen`; status chips read the store reactively (telemetry
 * fields like armed/mode/battery arrive in M1/M2, so they render as neutral
 * placeholders here).
 */
import { For, type Component } from 'solid-js';
import type { ConnState, ScreenId, VehicleState } from '../../contracts';
import { t } from '../../core/i18n';
import { formatChord } from '../../core/keybinds';
import { useShell } from './context';
import { useConnection } from './connection';
import { useAppSettings } from './appsettings/context';
import { activateScreenWorkspace } from './layout-actions';
import { SCREEN_ORDER } from './screens';
import { DEFAULT_WORKSPACE_ID, readShellLayout } from './workspace';

/** Map a {@link ConnState} to a catalog key for its chip label. */
function connKey(state: ConnState): string {
  return `conn.${state.kind === 'closed' ? 'closed' : state.kind}`;
}

/** Battery chip label: voltage + remaining %, whichever the vehicle reports. */
function batteryLabel(vehicle: VehicleState | undefined): string {
  const battery = vehicle?.battery;
  if (battery === undefined) return t('status.unknown');
  const parts: string[] = [`${battery.voltageV.toFixed(1)} V`];
  if (battery.remainingPct !== undefined) parts.push(`${Math.round(battery.remainingPct)}%`);
  return parts.join(' · ');
}

/** The persistent application top bar. */
export const TopBar: Component<{ onOpenPalette: () => void }> = (props) => {
  const { store, registry, keybinds } = useShell();
  const connection = useConnection();
  const appSettings = useAppSettings();
  // Extension-contributed top-bar items (e.g. the Hello World example):
  // `ctx.ui.addMenuItem('topbar', cmd)`.
  const topbarItems = (): readonly {
    location: string;
    item: { id: string; title: string; run: () => void | Promise<void> };
  }[] => registry.menuItems().filter((m) => m.location === 'topbar');
  // Nav highlight follows the dock's active workspace (audit D14): a screen
  // workspace highlights its nav item, the legacy default workspace (which
  // mirrors `activeScreen`) falls back to it, and a custom saved workspace
  // highlights nothing.
  const highlightedScreen = store.select((s) => {
    const id = readShellLayout(s.layout, t('workspace.default')).activeWorkspaceId;
    if ((SCREEN_ORDER as readonly string[]).includes(id)) return id;
    return id === DEFAULT_WORKSPACE_ID ? s.layout.activeScreen : undefined;
  });
  const conn = store.select((s) => s.connection);
  // Live vehicle status (audit D2): the active vehicle's armed/mode/battery.
  const vehicle = store.select((s) =>
    s.activeSysid !== undefined ? s.vehicles[s.activeSysid] : undefined,
  );
  // Shortcut labels derived live from the keybind registry (audit D10);
  // literals remain the fallback when no registry is injected.
  const shortcutLabel = (commandId: string, fallback: string): string => {
    const chord = keybinds?.chordFor(commandId);
    return chord !== undefined ? formatChord(chord) : fallback;
  };
  const paletteChordLabel = (): string => {
    const chord = keybinds?.chordFor('palette.open');
    return chord !== undefined ? formatChord(chord) : '⌘K';
  };

  const navigate = (screen: ScreenId): void => {
    activateScreenWorkspace(store, screen);
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
        aria-keyshortcuts={shortcutLabel('app.settings.open', 'Shift+S')}
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
              aria-current={highlightedScreen() === id ? 'page' : undefined}
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
        <span
          class="mvp-chip"
          classList={{
            'mvp-chip--armed': vehicle()?.armed === true,
            'mvp-chip--muted': vehicle()?.armed !== true,
          }}
        >
          {vehicle()?.armed === true ? t('status.armed') : t('status.disarmed')}
        </span>
        <span class="mvp-chip" classList={{ 'mvp-chip--muted': vehicle() === undefined }}>
          {t('status.mode')}: {vehicle()?.mode ?? t('status.unknown')}
        </span>
        <span class="mvp-chip" classList={{ 'mvp-chip--muted': vehicle()?.battery === undefined }}>
          {t('status.battery')} {batteryLabel(vehicle())}
        </span>
      </div>

      <For each={topbarItems()}>
        {(entry) => (
          <button
            type="button"
            class="mvp-chip mvp-chip--button"
            data-testid={`topbar-item-${entry.item.id}`}
            onClick={() => void entry.item.run()}
          >
            {entry.item.title}
          </button>
        )}
      </For>

      <button
        type="button"
        class="mvp-palette-btn"
        aria-keyshortcuts={shortcutLabel('palette.open', 'Control+K Meta+K')}
        title={t('topbar.openPalette')}
        onClick={() => props.onOpenPalette()}
      >
        <span aria-hidden="true">{paletteChordLabel()}</span>
        <span class="mvp-visually-hidden">{t('topbar.openPalette')}</span>
      </button>
    </header>
  );
};
