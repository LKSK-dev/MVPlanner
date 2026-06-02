/**
 * Component tests for the App Settings → Appearance section.
 *
 * Mounts {@link AppearanceSection} over a fresh in-memory {@link createAppStore}
 * and a typed fake {@link FileIo}, then asserts that the theme/density selects
 * and the custom-color inputs write into `settings.appearance` (and that an
 * invalid color is rejected and "Reset colors" clears the palette).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, render } from '@solidjs/testing-library';
import type { AppState, FileIo, Store, UiRegistry } from '../../src/contracts';
import type { KeybindRegistry } from '../../src/core/keybinds';
import type { RecentsStore } from '../../src/core/recents';
import { t } from '../../src/core/i18n';
import { createAppStore } from '../../src/core/store';
import { AppearanceSection } from '../../src/ui/shell/appsettings/sections/appearance';
import type { AppSettingsSectionDeps } from '../../src/ui/shell/appsettings/context';
import '../../src/ui/shell/appsettings/messages';

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Harness {
  readonly container: HTMLElement;
  readonly store: Store<AppState>;
  readonly files: FileIo;
}

function makeFiles(): FileIo {
  return {
    openForRead: vi.fn<FileIo['openForRead']>(async () => undefined),
    saveAs: vi.fn<FileIo['saveAs']>(async () => undefined),
  };
}

function mount(): Harness {
  const store = createAppStore();
  const files = makeFiles();
  const deps: AppSettingsSectionDeps = {
    store,
    t,
    files,
    recents: {} as RecentsStore,
    keybinds: {} as KeybindRegistry,
    persistKeybinds: () => undefined,
    registry: {} as UiRegistry,
    setSection: () => undefined,
    close: () => undefined,
  };
  const { container } = render(() => createComponent(AppearanceSection, { deps }));
  return { container, store, files };
}

function query<E extends Element>(container: HTMLElement, testid: string): E {
  const el = container.querySelector<E>(`[data-testid="${testid}"]`);
  if (el === null) throw new Error(`missing element: ${testid}`);
  return el;
}

afterEach(() => cleanup());

describe('Appearance section', () => {
  it('writes theme mode and density into settings.appearance', async () => {
    const h = mount();
    await settle();

    const theme = query<HTMLSelectElement>(h.container, 'appearance-theme');
    theme.value = 'light';
    theme.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(h.store.get().settings.appearance?.themeMode).toBe('light');

    const density = query<HTMLSelectElement>(h.container, 'appearance-density');
    density.value = 'compact';
    density.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(h.store.get().settings.appearance?.density).toBe('compact');
    // Sibling preserved.
    expect(h.store.get().settings.appearance?.themeMode).toBe('light');
  });

  it('writes a valid color and rejects an invalid one', async () => {
    const h = mount();
    await settle();

    const accent = query<HTMLInputElement>(h.container, 'appearance-color-accent');
    accent.value = '#123456';
    accent.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(h.store.get().settings.appearance?.colors?.accent).toBe('#123456');

    // An invalid value must not overwrite the stored color, and shows the hint.
    accent.value = 'not a color';
    accent.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(h.store.get().settings.appearance?.colors?.accent).toBe('#123456');
    expect(
      h.container.querySelector('[data-testid="appearance-color-accent-invalid"]'),
    ).not.toBeNull();
  });

  it('reset colors clears the custom palette', async () => {
    const h = mount();
    await settle();

    const accent = query<HTMLInputElement>(h.container, 'appearance-color-accent');
    accent.value = '#abcdef';
    accent.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(h.store.get().settings.appearance?.colors?.accent).toBe('#abcdef');

    query<HTMLButtonElement>(h.container, 'appearance-reset-colors').click();
    await settle();
    expect(h.store.get().settings.appearance?.colors).toBeUndefined();
  });
});
