/**
 * App Settings pane integration: the pane opens from its control, renders the
 * section rail, switches sections, and closes (× / Escape). Sections are tested
 * individually elsewhere; this asserts the assembled shell.
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach } from 'vitest';
import { createComponent } from 'solid-js';
import { createAppStore } from '../../src/core/store';
import { createRecentsStore } from '../../src/core/recents';
import { createKeybindRegistry } from '../../src/core/keybinds';
import { createUiRegistry } from '../../src/ui/shell';
import { t } from '../../src/core/i18n';
import {
  AppSettingsPane,
  buildAppSettingsSections,
  createAppSettingsControl,
  type AppSettingsSectionDeps,
} from '../../src/ui/shell/appsettings';
import type { BlobStore } from '../../src/contracts';
import { fakeFiles, fakeKv } from '../helpers';

afterEach(cleanup);

function fakeBlobs(): BlobStore {
  return {
    put: async () => undefined,
    getRange: async () => new Uint8Array(),
    size: async () => 0,
    list: async () => [],
    del: async () => undefined,
  };
}
function makeDeps(): AppSettingsSectionDeps {
  const store = createAppStore();
  return {
    store,
    t,
    files: fakeFiles(),
    recents: createRecentsStore({ kv: fakeKv(), blobs: fakeBlobs() }),
    keybinds: createKeybindRegistry({ commands: [{ id: 'nav.flight', title: 'Flight' }] }),
    persistKeybinds: vi.fn(),
    registry: createUiRegistry(),
    setSection: vi.fn(),
    close: vi.fn(),
  };
}

describe('AppSettingsPane', () => {
  it('renders nothing until opened, then shows the rail + a section', () => {
    const control = createAppSettingsControl('appearance');
    const deps = makeDeps();
    const sections = buildAppSettingsSections();
    const { container, queryByText } = render(() =>
      createComponent(AppSettingsPane, { control, sections, deps }),
    );
    expect(queryByText(t('appsettings.title'))).toBeNull();

    control.open();
    // All eight section tabs present.
    for (const s of sections) {
      expect(container.querySelector(`[data-testid="appsettings-tab-${s.id}"]`)).toBeTruthy();
    }
    // The active (appearance) section is rendered.
    expect(container.querySelector('[data-section="appearance"]')).toBeTruthy();
  });

  it('switches sections via the rail and closes with ×', () => {
    const control = createAppSettingsControl('appearance');
    const { container } = render(() =>
      createComponent(AppSettingsPane, {
        control,
        sections: buildAppSettingsSections(),
        deps: makeDeps(),
      }),
    );
    control.open();
    fireEvent.click(
      container.querySelector('[data-testid="appsettings-tab-units"]') as HTMLElement,
    );
    expect(container.querySelector('[data-section="units"]')).toBeTruthy();
    fireEvent.click(container.querySelector('[data-testid="appsettings-close"]') as HTMLElement);
    expect(container.querySelector('.mvp-appsettings')).toBeNull();
  });
});
