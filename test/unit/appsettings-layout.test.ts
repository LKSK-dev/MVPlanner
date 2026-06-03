/**
 * Settings → Appearance "Windows & layout" editor (UI remake Phase 4): workspace
 * switcher, add-widget palette, widget list + remove, reset-to-preset.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createComponent } from 'solid-js';
import { createAppStore } from '../../src/core/store';
import { createUiRegistry } from '../../src/ui/shell';
import { LayoutControls } from '../../src/ui/shell/appsettings/sections/layout';
import { SHELL_LAYOUT_KEY, makePanel, type ShellLayout } from '../../src/ui/shell/workspace';
import { t } from '../../src/core/i18n';
import '../../src/ui/shell/appsettings/messages';
import type { AppSettingsSectionDeps } from '../../src/ui/shell/appsettings';
import type { ShellRegistry } from '../../src/ui/shell/registry';
import type { AppState, PanelDef, Store } from '../../src/contracts';

afterEach(cleanup);

function widget(id: string, title: string, category = 'Test'): PanelDef {
  return { id, title, meta: { category }, mount: () => undefined };
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

function deps(store: Store<AppState>, panels: PanelDef[]): AppSettingsSectionDeps {
  const registry = createUiRegistry();
  for (const p of panels) registry.registerPanel(p);
  return { store, t, registry: registry as ShellRegistry } as unknown as AppSettingsSectionDeps;
}

describe('LayoutControls', () => {
  it('lists workspace widgets, offers the catalog, and removes a widget', async () => {
    const store = storeWith({
      type: 'split',
      id: 's',
      direction: 'row',
      sizes: [0.5, 0.5],
      children: [makePanel('w.map', 'A'), makePanel('w.hud', 'B')],
    });
    const c = render(() =>
      createComponent(LayoutControls, {
        deps: deps(store, [
          widget('w.map', 'Map'),
          widget('w.hud', 'HUD'),
          widget('w.insp', 'Inspector'),
        ]),
      }),
    ).container;

    // Two widgets in the workspace -> two remove buttons.
    expect(c.querySelector('[data-testid="layout-remove-A"]')).toBeTruthy();
    expect(c.querySelector('[data-testid="layout-remove-B"]')).toBeTruthy();
    // The add palette lists the registered widgets.
    const addSel = c.querySelector('[data-testid="layout-add-widget"]') as HTMLSelectElement;
    expect([...addSel.querySelectorAll('option')].map((o) => o.textContent)).toContain('Inspector');

    // Remove one widget.
    fireEvent.click(c.querySelector('[data-testid="layout-remove-A"]') as HTMLButtonElement);
    await new Promise((r) => setTimeout(r, 0));
    expect(c.querySelector('[data-testid="layout-remove-A"]')).toBeNull();
  });

  it('adds a widget from the palette', async () => {
    const store = storeWith(makePanel('w.map', 'A'));
    const c = render(() =>
      createComponent(LayoutControls, {
        deps: deps(store, [widget('w.map', 'Map'), widget('w.insp', 'Inspector')]),
      }),
    ).container;
    const addSel = c.querySelector('[data-testid="layout-add-widget"]') as HTMLSelectElement;
    addSel.value = 'w.insp';
    fireEvent.change(addSel);
    await new Promise((r) => setTimeout(r, 0));
    // Now two widgets -> remove buttons appear.
    expect(c.querySelectorAll('[data-testid^="layout-remove-"]').length).toBe(2);
  });
});
