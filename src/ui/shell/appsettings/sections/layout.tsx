/**
 * MVPlanner Settings → Appearance: Windows & layout controls (UI remake Phase 4).
 *
 * Configure the dockable workspace from Settings: pick the active workspace, add
 * widgets from the registered catalog, remove widgets, and reset a workspace to
 * its built-in preset. All mutations go through the shared `layout-actions` over
 * the pure dock reducers, so the in-canvas dock and this editor stay in sync.
 * (Resizing is done by dragging the dividers in the workspace itself.)
 */
import { For, Show, createMemo, type Component } from 'solid-js';
import type { AppSettingsSectionDeps } from '../context';
import {
  activeWorkspace,
  allPanels,
  readShellLayout,
  widgetIdOf,
  type PanelNode,
} from '../../workspace';
import {
  addWidget,
  closeWidget,
  resetActiveWorkspace,
  setActiveWorkspace,
} from '../../layout-actions';
import { groupByCategory, widgetCatalog } from '../../presets';

/** Windows & layout editor, embedded in the Appearance section. */
export const LayoutControls: Component<{ deps: AppSettingsSectionDeps }> = (props) => {
  const { store, t, registry } = props.deps;
  const shell = store.select((s) => readShellLayout(s.layout, t('workspace.default')));
  const ws = createMemo(() => activeWorkspace(shell()));
  const panels = createMemo<readonly PanelNode[]>(() => allPanels(ws().root));
  const presentIds = createMemo(() => new Set(panels().map((p) => widgetIdOf(p))));
  // Offer every widget, but hide single-instance widgets already in the workspace.
  const groups = createMemo(() =>
    [
      ...groupByCategory(
        widgetCatalog(registry.panels()).filter((w) => !(w.singleton && presentIds().has(w.id))),
      ).entries(),
    ].filter(([, entries]) => entries.length > 0),
  );

  const widgetTitle = (panel: PanelNode): string => {
    const id = widgetIdOf(panel);
    if (id.startsWith('screen.')) return t(`nav.${id.slice('screen.'.length)}`);
    return registry.getPanel(id)?.title ?? id;
  };

  return (
    <section class="mvp-appsettings__group" aria-label={t('appsettings.layout.title')}>
      <h3>{t('appsettings.layout.title')}</h3>
      <p class="mvp-appsettings__hint">{t('appsettings.layout.intro')}</p>

      <label class="mvp-appsettings__field">
        <span class="mvp-appsettings__label">{t('appsettings.layout.workspace')}</span>
        <select
          class="mvp-appsettings__select"
          data-testid="layout-workspace"
          value={shell().activeWorkspaceId}
          onChange={(e) => setActiveWorkspace(store, e.currentTarget.value)}
        >
          <For each={shell().order}>
            {(id) => (
              <Show when={shell().workspaces[id]}>
                {(w) => <option value={id}>{w().name}</option>}
              </Show>
            )}
          </For>
        </select>
      </label>

      <label class="mvp-appsettings__field">
        <span class="mvp-appsettings__label">{t('appsettings.layout.addWidget')}</span>
        <select
          class="mvp-appsettings__select"
          data-testid="layout-add-widget"
          value=""
          onChange={(e) => {
            const value = e.currentTarget.value;
            if (value !== '') {
              addWidget(store, value);
              e.currentTarget.value = '';
            }
          }}
        >
          <option value="" disabled>
            {t('appsettings.layout.addWidget.placeholder')}
          </option>
          <For each={groups()}>
            {([category, entries]) => (
              <optgroup label={category}>
                <For each={entries}>{(w) => <option value={w.id}>{w.title}</option>}</For>
              </optgroup>
            )}
          </For>
        </select>
      </label>

      <h4 class="mvp-appsettings__label">{t('appsettings.layout.widgets')}</h4>
      <Show
        when={panels().length > 0}
        fallback={<p class="mvp-appsettings__hint">{t('appsettings.layout.empty')}</p>}
      >
        <For each={panels()}>
          {(panel) => (
            <div class="mvp-appsettings__keyrow">
              <span>{widgetTitle(panel)}</span>
              <Show when={panels().length > 1}>
                <button
                  type="button"
                  class="mvp-appsettings__btn"
                  data-testid={`layout-remove-${panel.id}`}
                  onClick={() => closeWidget(store, panel.id)}
                >
                  {t('appsettings.layout.remove')}
                </button>
              </Show>
            </div>
          )}
        </For>
      </Show>

      <div class="mvp-appsettings__actions">
        <button
          type="button"
          class="mvp-appsettings__btn"
          data-testid="layout-reset"
          onClick={() => resetActiveWorkspace(store)}
        >
          {t('appsettings.layout.resetPreset')}
        </button>
      </div>
    </section>
  );
};
