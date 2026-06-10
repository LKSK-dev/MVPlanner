/**
 * Dockable/tiling panel manager v2 (UI remake Phase 1; spec docs/ui-remake).
 *
 * A workspace is a tree of {@link DockNode}s rendered here: **split** containers
 * tile children with draggable resize gutters; **tab** containers stack widget
 * panels behind a tab strip; **panel** leaves mount a registered widget inside
 * consistent chrome (header + per-widget menu). Each mounted widget is isolated
 * by an {@link ErrorBoundary} so one faulty widget can never blank the app, and a
 * transient maximize state lets a panel fill the workspace. All layout mutation
 * goes through the pure reducers in `./workspace` via `./layout-actions`.
 *
 * Sizes + the active workspace persist through the store `layout`.
 */
import {
  ErrorBoundary,
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type Component,
} from 'solid-js';
import type { PanelApi } from '../../contracts';
import { useShell } from './context';
import { screenPanelId } from './screens';
import { closeWidget, setWidgetTab } from './layout-actions';
import {
  ACTIVE_SCREEN,
  activeWorkspace,
  countPanels,
  readShellLayout,
  setSplitSizes,
  widgetIdOf,
  writeShellLayout,
  type DockNode,
  type PanelNode,
  type SplitNode,
  type TabNode,
} from './workspace';
import { t } from '../../core/i18n';

/** Maximized widget instance id for the active workspace (transient, not persisted). */
const [maximizedId, setMaximizedId] = createSignal<string | undefined>(undefined);

/** Equal fractional distribution for `count` children. */
function equalizeSizes(count: number): number[] {
  return Array.from({ length: count }, () => 1 / count);
}

/** Resolve the widget id a panel should mount (follows the active screen sentinel). */
function useResolvedWidgetId(node: PanelNode): () => string {
  const { store } = useShell();
  const activeScreen = store.select((s) => s.layout.activeScreen);
  const wid = widgetIdOf(node);
  return () => (wid === ACTIVE_SCREEN ? screenPanelId(activeScreen()) : wid);
}

/** Human title for a resolved widget/screen id. */
function useWidgetTitle(resolvedId: () => string): () => string {
  const { registry, panelApi } = useShell();
  return createMemo<string>(() => {
    const id = resolvedId();
    if (id.startsWith('screen.')) return panelApi.t(`nav.${id.slice('screen.'.length)}`);
    return registry.getPanel(id)?.title ?? id;
  });
}

/** The imperatively-mounted widget body, isolated by an error boundary. */
const WidgetHost: Component<{ node: PanelNode }> = (props) => {
  const { registry, panelApi } = useShell();
  const resolvedId = useResolvedWidgetId(props.node);
  let host: HTMLDivElement | undefined;
  let dispose: (() => void) | undefined;

  createEffect(() => {
    const id = resolvedId();
    dispose?.();
    dispose = undefined;
    if (!host) return;
    host.replaceChildren();
    const def = registry.getPanel(id);
    if (!def) return;
    const api: PanelApi =
      props.node.settings !== undefined ? { ...panelApi, settings: props.node.settings } : panelApi;
    dispose = def.mount(host, api) ?? undefined;
  });
  onCleanup(() => dispose?.());

  return (
    <ErrorBoundary
      fallback={(_err, reset) => (
        <div class="mvp-dock-panel__error" role="alert">
          <p>{t('dock.widgetError')}</p>
          <button type="button" class="mvp-dock-panel__error-reload" onClick={reset}>
            {t('dock.reload')}
          </button>
        </div>
      )}
    >
      <div class="mvp-dock-panel__body" ref={host} />
    </ErrorBoundary>
  );
};

/** Header controls (maximize/restore + close) shared by panels + tab groups. */
const ChromeControls: Component<{ panelId: string }> = (props) => {
  const { store } = useShell();
  const isMax = (): boolean => maximizedId() === props.panelId;
  // Reactive panel count so the last-panel close guard updates live.
  const panelCount = store.select((s) =>
    countPanels(activeWorkspace(readShellLayout(s.layout, t('workspace.default'))).root),
  );
  const canClose = (): boolean => panelCount() > 1;
  return (
    <span class="mvp-dock-panel__controls">
      <button
        type="button"
        class="mvp-dock-panel__ctl"
        aria-label={isMax() ? t('dock.restore') : t('dock.maximize')}
        title={isMax() ? t('dock.restore') : t('dock.maximize')}
        onClick={() => setMaximizedId(isMax() ? undefined : props.panelId)}
      >
        <span aria-hidden="true">{isMax() ? '❐' : '❑'}</span>
      </button>
      <Show when={canClose()}>
        <button
          type="button"
          class="mvp-dock-panel__ctl"
          aria-label={t('dock.close')}
          title={t('dock.close')}
          onClick={() => {
            if (maximizedId() === props.panelId) setMaximizedId(undefined);
            closeWidget(store, props.panelId);
          }}
        >
          <span aria-hidden="true">{'×'}</span>
        </button>
      </Show>
    </span>
  );
};

/** A single widget panel with header chrome. */
const DockPanelView: Component<{ node: PanelNode }> = (props) => {
  const resolvedId = useResolvedWidgetId(props.node);
  const title = useWidgetTitle(resolvedId);
  return (
    <section class="mvp-dock-panel" data-panel-id={props.node.id}>
      <header class="mvp-dock-panel__header">
        <span class="mvp-dock-panel__title">{title()}</span>
        <ChromeControls panelId={props.node.id} />
      </header>
      <WidgetHost node={props.node} />
    </section>
  );
};

/** A tab container: a tab strip over stacked widget bodies (all kept mounted). */
const DockTabView: Component<{ node: TabNode }> = (props) => {
  const { store } = useShell();
  const activeChild = createMemo<PanelNode | undefined>(
    () => props.node.children[props.node.active],
  );
  return (
    <section class="mvp-dock-panel" data-tabs-id={props.node.id}>
      <header class="mvp-dock-panel__header mvp-dock-panel__header--tabs">
        <div
          class="mvp-dock-tabs"
          role="tablist"
          aria-orientation="horizontal"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            e.preventDefault();
            const n = props.node.children.length;
            const next =
              e.key === 'ArrowRight'
                ? (props.node.active + 1) % n
                : (props.node.active - 1 + n) % n;
            setWidgetTab(store, props.node.id, next);
            // Roving tabindex: move DOM focus to the newly-active tab button.
            const tabs = e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]');
            tabs[next]?.focus();
          }}
        >
          <For each={props.node.children}>
            {(child, i) => (
              <TabLabel
                node={child}
                active={i() === props.node.active}
                onSelect={() => setWidgetTab(store, props.node.id, i())}
              />
            )}
          </For>
        </div>
        <Show when={activeChild()}>{(child) => <ChromeControls panelId={child().id} />}</Show>
      </header>
      {/* Keep every tab mounted; show only the active one (preserves widget state). */}
      <div class="mvp-dock-tabs__bodies">
        <For each={props.node.children}>
          {(child, i) => (
            <div
              class="mvp-dock-tabs__body"
              role="tabpanel"
              classList={{ 'mvp-dock-tabs__body--active': i() === props.node.active }}
            >
              <WidgetHost node={child} />
            </div>
          )}
        </For>
      </div>
    </section>
  );
};

/** One tab button, labelled with its widget title. */
const TabLabel: Component<{ node: PanelNode; active: boolean; onSelect: () => void }> = (props) => {
  const resolvedId = useResolvedWidgetId(props.node);
  const title = useWidgetTitle(resolvedId);
  return (
    <button
      type="button"
      role="tab"
      class="mvp-dock-tab"
      classList={{ 'mvp-dock-tab--active': props.active }}
      aria-selected={props.active}
      tabindex={props.active ? 0 : -1}
      onClick={() => props.onSelect()}
    >
      {title()}
    </button>
  );
};

/** A split container that tiles children with draggable resize gutters. */
const DockSplitView: Component<{ node: SplitNode }> = (props) => {
  const { store } = useShell();

  /** Cleanup for an in-flight gutter drag (so unmount mid-drag never leaks). */
  let activeDragUp: (() => void) | undefined;
  onCleanup(() => activeDragUp?.());

  const onGutterDown = (index: number, e: PointerEvent): void => {
    e.preventDefault();
    const container = (e.currentTarget as HTMLElement).parentElement;
    if (!container) return;
    const horizontal = props.node.direction === 'row';
    const rect = container.getBoundingClientRect();
    const total = horizontal ? rect.width : rect.height;
    if (total <= 0) return;
    const startSizes = [...props.node.sizes];
    const start = horizontal ? e.clientX : e.clientY;
    const pointerId = e.pointerId;
    const gutter = e.currentTarget as HTMLElement;
    gutter.setPointerCapture(pointerId);

    const move = (ev: PointerEvent): void => {
      const deltaFrac = ((horizontal ? ev.clientX : ev.clientY) - start) / total;
      const a = (startSizes[index] ?? 0) + deltaFrac;
      const b = (startSizes[index + 1] ?? 0) - deltaFrac;
      const next = [...startSizes];
      next[index] = a;
      next[index + 1] = b;
      store.patch((s) => {
        const shell = readShellLayout(s.layout, t('workspace.default'));
        const ws = activeWorkspace(shell);
        const root = setSplitSizes(ws.root, props.node.id, next);
        writeShellLayout(s.layout, {
          ...shell,
          workspaces: { ...shell.workspaces, [ws.id]: { ...ws, root } },
        });
      });
    };
    const up = (): void => {
      activeDragUp = undefined;
      gutter.releasePointerCapture?.(pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    activeDragUp = up;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  /** Persist a sizes change for this split. */
  const applySizes = (next: readonly number[]): void => {
    store.patch((s) => {
      const shell = readShellLayout(s.layout, t('workspace.default'));
      const ws = activeWorkspace(shell);
      const root = setSplitSizes(ws.root, props.node.id, next);
      writeShellLayout(s.layout, {
        ...shell,
        workspaces: { ...shell.workspaces, [ws.id]: { ...ws, root } },
      });
    });
  };

  /** Keyboard resize: Arrow keys nudge the boundary; Home equalizes. */
  const onGutterKey = (index: number, e: KeyboardEvent): void => {
    const horizontal = props.node.direction === 'row';
    const dec = horizontal ? 'ArrowLeft' : 'ArrowUp';
    const inc = horizontal ? 'ArrowRight' : 'ArrowDown';
    if (e.key === 'Home') {
      e.preventDefault();
      applySizes(equalizeSizes(props.node.children.length));
      return;
    }
    if (e.key !== dec && e.key !== inc) return;
    e.preventDefault();
    const step = e.key === inc ? 0.03 : -0.03;
    const sizes = [...props.node.sizes];
    sizes[index] = (sizes[index] ?? 0) + step;
    sizes[index + 1] = (sizes[index + 1] ?? 0) - step;
    applySizes(sizes);
  };

  return (
    <div
      class="mvp-dock-split"
      classList={{ 'mvp-dock-split--col': props.node.direction === 'column' }}
    >
      <For each={props.node.children}>
        {(child, i) => (
          <>
            <div class="mvp-dock-cell" style={{ flex: `${props.node.sizes[i()] ?? 1} 1 0` }}>
              <DockNodeView node={child} />
            </div>
            <Show when={i() < props.node.children.length - 1}>
              <div
                class="mvp-dock-gutter"
                role="separator"
                tabindex={0}
                aria-orientation={props.node.direction === 'row' ? 'vertical' : 'horizontal'}
                aria-label={t('dock.resizePanels')}
                onKeyDown={(e) => onGutterKey(i(), e)}
                onDblClick={() => applySizes(equalizeSizes(props.node.children.length))}
                onPointerDown={(e) => onGutterDown(i(), e)}
              />
            </Show>
          </>
        )}
      </For>
    </div>
  );
};

/** Render any dock node (split / tabs / panel). */
const DockNodeView: Component<{ node: DockNode }> = (props) => (
  <Show
    when={props.node.type === 'split' ? (props.node as SplitNode) : undefined}
    fallback={
      <Show
        when={props.node.type === 'tabs' ? (props.node as TabNode) : undefined}
        fallback={<DockPanelView node={props.node as PanelNode} />}
      >
        {(tabs) => <DockTabView node={tabs()} />}
      </Show>
    }
  >
    {(split) => <DockSplitView node={split()} />}
  </Show>
);

/** The dock surface: renders the active workspace tree (or a maximized panel). */
export const DockManager: Component = () => {
  const { store } = useShell();
  const root = store.select(
    (s) => activeWorkspace(readShellLayout(s.layout, t('workspace.default'))).root,
  );
  const maximizedPanel = createMemo<PanelNode | undefined>(() => {
    const id = maximizedId();
    if (id === undefined) return undefined;
    return allPanelsOf(root()).find((p) => p.id === id);
  });
  // Drop a stale maximize when its panel leaves the active tree (workspace
  // switch or external close) so the next workspace renders normally.
  createEffect(() => {
    const id = maximizedId();
    if (id !== undefined && !allPanelsOf(root()).some((p) => p.id === id)) {
      setMaximizedId(undefined);
    }
  });
  return (
    <div class="mvp-dock">
      <Show when={maximizedPanel()} fallback={<DockNodeView node={root()} />}>
        {(panel) => <DockPanelView node={panel()} />}
      </Show>
    </div>
  );
};

/** Local panel-collector (avoids importing the reducer just for this). */
function allPanelsOf(node: DockNode): PanelNode[] {
  if (node.type === 'panel') return [node];
  const out: PanelNode[] = [];
  for (const child of node.children) out.push(...allPanelsOf(child));
  return out;
}
