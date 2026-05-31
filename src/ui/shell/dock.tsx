/**
 * Hand-rolled dockable/tiling panel manager (T0.7; spec plan/05 §5.3).
 *
 * A workspace is a tree of {@link DockNode}s: split containers tile their
 * children along one axis with draggable, resizable gutters; panel leaves mount
 * a registered {@link PanelDef} imperatively. Sizes and the active workspace are
 * persisted through the store's `layout` (see {@link workspace}), so layouts
 * survive reloads. No heavyweight dependency — just CSS flex + Solid signals.
 *
 * For M0 the default workspace is a single panel whose content follows
 * `layout.activeScreen`; the split/resize/persist/restore framework is what
 * matters and is exercised by the workspace unit tests.
 */
import { For, Show, createEffect, createMemo, onCleanup, type Component } from 'solid-js';
import { useShell } from './context';
import { screenPanelId } from './screens';
import {
  ACTIVE_SCREEN,
  activeWorkspace,
  readShellLayout,
  setSplitSizes,
  writeShellLayout,
  type DockNode,
  type SplitNode,
} from './workspace';
import { t } from '../../core/i18n';

/** Resolve the panel id a leaf should mount, following the active screen. */
function useResolvedPanelId(panelId: string): () => string {
  const { store } = useShell();
  const activeScreen = store.select((s) => s.layout.activeScreen);
  return () => (panelId === ACTIVE_SCREEN ? screenPanelId(activeScreen()) : panelId);
}

/** A single dock leaf: header + an imperatively-mounted panel body. */
const DockPanelView: Component<{ panelId: string }> = (props) => {
  const { registry, panelApi } = useShell();
  const resolvedId = useResolvedPanelId(props.panelId);
  let host: HTMLDivElement | undefined;
  let dispose: (() => void) | undefined;

  const title = createMemo<string>(() => {
    const id = resolvedId();
    if (id.startsWith('screen.')) return panelApi.t(`nav.${id.slice('screen.'.length)}`);
    return registry.getPanel(id)?.title ?? id;
  });

  // Re-mount whenever the resolved panel changes (e.g. screen switch).
  createEffect(() => {
    const id = resolvedId();
    dispose?.();
    dispose = undefined;
    if (!host) return;
    host.replaceChildren();
    const def = registry.getPanel(id);
    if (def) dispose = def.mount(host, panelApi) ?? undefined;
  });
  onCleanup(() => dispose?.());

  return (
    <section class="mvp-dock-panel">
      <header class="mvp-dock-panel__header">{title()}</header>
      <div class="mvp-dock-panel__body" ref={host} />
    </section>
  );
};

/** A split container that tiles children with draggable resize gutters. */
const DockSplitView: Component<{ node: SplitNode }> = (props) => {
  const { store } = useShell();

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
      gutter.releasePointerCapture?.(pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
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
                aria-orientation={props.node.direction === 'row' ? 'vertical' : 'horizontal'}
                aria-label={t('dock.resizePanels')}
                onPointerDown={(e) => onGutterDown(i(), e)}
              />
            </Show>
          </>
        )}
      </For>
    </div>
  );
};

/** Render any dock node (panel leaf or split container). */
const DockNodeView: Component<{ node: DockNode }> = (props) => (
  <Show
    when={props.node.type === 'split' ? (props.node as SplitNode) : undefined}
    fallback={
      <DockPanelView panelId={(props.node as Extract<DockNode, { type: 'panel' }>).panelId} />
    }
  >
    {(split) => <DockSplitView node={split()} />}
  </Show>
);

/** The dock surface: renders the active workspace's tree. */
export const DockManager: Component = () => {
  const { store } = useShell();
  const root = store.select(
    (s) => activeWorkspace(readShellLayout(s.layout, t('workspace.default'))).root,
  );
  return (
    <div class="mvp-dock">
      <DockNodeView node={root()} />
    </div>
  );
};
