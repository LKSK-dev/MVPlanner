/**
 * Dock v2 rendering tests (UI remake Phase 1): split/tabs/panel render with
 * chrome, tab switching, and close (last-panel guard). Uses a real store +
 * registry with mock widget panels and a seeded tab layout.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createComponent } from 'solid-js';
import { createAppStore } from '../../src/core/store';
import { createUiRegistry, ShellContext, type ShellContextValue } from '../../src/ui/shell';
import { DockManager } from '../../src/ui/shell/dock';
import { SHELL_LAYOUT_KEY, makePanel, type ShellLayout } from '../../src/ui/shell/workspace';
import { t } from '../../src/core/i18n';
import type { AppState, PanelDef, Store } from '../../src/contracts';

afterEach(cleanup);

function widget(id: string, title: string): PanelDef {
  return {
    id,
    title,
    meta: { category: 'Test' },
    mount: (el) => {
      el.textContent = `body:${id}`;
      return () => undefined;
    },
  };
}

function storeWith(root: ShellLayout['workspaces'][string]['root']): Store<AppState> {
  const shell: ShellLayout = {
    schemaVersion: 2,
    activeWorkspaceId: 'w',
    order: ['w'],
    workspaces: { w: { id: 'w', name: 'W', root } },
  };
  return createAppStore({
    layout: { activeScreen: 'flight', workspaces: { [SHELL_LAYOUT_KEY]: shell } },
  });
}

function mountDock(store: Store<AppState>, panels: PanelDef[]): HTMLElement {
  const registry = createUiRegistry();
  for (const p of panels) registry.registerPanel(p);
  const ctx: ShellContextValue = {
    store,
    registry,
    capabilities: { webSerial: true } as never,
    panelApi: { store, t },
  };
  const { container } = render(() =>
    createComponent(ShellContext.Provider, {
      value: ctx,
      get children() {
        return createComponent(DockManager, {});
      },
    }),
  );
  return container;
}

describe('DockManager v2', () => {
  it('renders a split of two widget panels with chrome + bodies', () => {
    const store = storeWith({
      type: 'split',
      id: 's',
      direction: 'row',
      sizes: [0.5, 0.5],
      children: [makePanel('w.map', 'A'), makePanel('w.hud', 'B')],
    });
    const c = mountDock(store, [widget('w.map', 'Map'), widget('w.hud', 'HUD')]);
    expect(c.querySelectorAll('.mvp-dock-panel').length).toBe(2);
    expect(c.textContent).toContain('Map');
    expect(c.textContent).toContain('HUD');
    expect(c.textContent).toContain('body:w.map');
    // Two panels -> close controls present.
    expect(c.querySelector('[aria-label="' + t('dock.close') + '"]')).toBeTruthy();
  });

  it('renders a tab group + switches the active tab', async () => {
    const store = storeWith({
      type: 'tabs',
      id: 'tg',
      active: 0,
      children: [makePanel('w.map', 'A'), makePanel('w.hud', 'B')],
    });
    const c = mountDock(store, [widget('w.map', 'Map'), widget('w.hud', 'HUD')]);
    const tabs = [...c.querySelectorAll<HTMLButtonElement>('.mvp-dock-tab')];
    expect(tabs.map((b) => b.textContent)).toEqual(['Map', 'HUD']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    fireEvent.click(tabs[1] as HTMLButtonElement);
    await new Promise((r) => setTimeout(r, 0));
    expect(
      [...c.querySelectorAll<HTMLButtonElement>('.mvp-dock-tab')][1]?.getAttribute('aria-selected'),
    ).toBe('true');
  });

  it('hides the close control on a single-panel workspace (last-panel guard)', () => {
    const store = storeWith(makePanel('w.map', 'A'));
    const c = mountDock(store, [widget('w.map', 'Map')]);
    expect(c.querySelector('[aria-label="' + t('dock.close') + '"]')).toBeNull();
  });
});
