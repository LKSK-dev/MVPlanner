/**
 * Registration glue for the Quick-watch widget (task T2.9; spec plan/05
 * §5.3/§5.4/§5.5).
 *
 * Exposes the widget to the app through the frozen {@link UiRegistry} as a
 * dockable panel, without hard-wiring it into the shell tree. T2.11 calls
 * {@link registerQuickWatch} once with the host-backed {@link QuickWatchSource}
 * and store-backed watch list; everything is disposed via the returned function.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { PanelApi, PanelDef, UiRegistry } from '../../../contracts';
import { QuickWatch } from './quickwatch';
import type { QuickWatchField, QuickWatchSource, TFn } from './types';

/** Stable panel id (workspaces/extensions may dock Quick-watch by this id). */
export const QUICKWATCH_PANEL_ID = 'widget.quickwatch';

/** Optional wiring for {@link createQuickWatchPanel} / {@link registerQuickWatch}. */
export interface QuickWatchPanelOptions {
  /** Initial watch list (T2.11 seeds this from the persisted store). */
  watches?: readonly QuickWatchField[];
  /** Persist callback invoked when the watch list changes. */
  onChange?: (watches: readonly QuickWatchField[]) => void;
  /** Recent-sample ring capacity per watch. */
  capacity?: number;
}

/** Build the dockable Quick-watch {@link PanelDef} bound to `source`. */
export function createQuickWatchPanel(
  source: QuickWatchSource,
  t: TFn,
  opts: QuickWatchPanelOptions = {},
): PanelDef {
  return {
    id: QUICKWATCH_PANEL_ID,
    title: t('quickwatch.panel.label'),
    icon: 'quickwatch',
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(
        () =>
          createComponent(QuickWatch, {
            source,
            t: api.t,
            ...(opts.watches !== undefined ? { watches: opts.watches } : {}),
            ...(opts.onChange !== undefined ? { onChange: opts.onChange } : {}),
            ...(opts.capacity !== undefined ? { capacity: opts.capacity } : {}),
          }),
        el,
      );
    },
  };
}

/**
 * Register the Quick-watch panel on the shell {@link UiRegistry}. Returns a
 * disposer that unregisters it.
 */
export function registerQuickWatch(
  registry: UiRegistry,
  source: QuickWatchSource,
  t: TFn,
  opts: QuickWatchPanelOptions = {},
): () => void {
  return registry.registerPanel(createQuickWatchPanel(source, t, opts));
}
