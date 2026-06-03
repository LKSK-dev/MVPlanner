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
import type { AppState, FileIo, InstalledTheme, Store } from '../../src/contracts';
import { createUiRegistry } from '../../src/ui/shell';
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

/** A valid `.mvptheme.json` bundle the install flow accepts. */
function themeBlob(bundle: Record<string, unknown>): { name: string; blob: Blob } {
  return {
    name: 'custom.mvptheme.json',
    blob: new Blob([JSON.stringify({ kind: 'mvplanner-theme', version: 1, ...bundle })]),
  };
}

/** First installed theme in the store (throws when none installed). */
function firstTheme(store: Store<AppState>): InstalledTheme {
  const lib = store.get().settings.appearance?.themeLibrary;
  if (lib === undefined || lib.length === 0) throw new Error('no installed theme');
  return lib[0]!;
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
    registry: createUiRegistry(),
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
    theme.value = 'builtin:light';
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

  it('writes the outline color override', async () => {
    const h = mount();
    await settle();

    const outline = query<HTMLInputElement>(h.container, 'appearance-color-outline');
    outline.value = '#0a0b0c';
    outline.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
    expect(h.store.get().settings.appearance?.colors?.outline).toBe('#0a0b0c');
  });

  it('installs a theme into the library and makes it active', async () => {
    const h = mount();
    await settle();
    vi.mocked(h.files.openForRead).mockResolvedValueOnce(
      themeBlob({ themeMode: 'dark', colors: { accent: '#ff0000' } }),
    );

    query<HTMLButtonElement>(h.container, 'appearance-install-theme').click();
    await settle();

    const lib = h.store.get().settings.appearance?.themeLibrary;
    expect(lib).toHaveLength(1);
    expect(lib?.[0]?.bundle.themeMode).toBe('dark');
    expect(lib?.[0]?.bundle.colors?.accent).toBe('#ff0000');
    expect(h.store.get().settings.appearance?.activeThemeId).toBe(lib?.[0]?.id);
    expect(h.container.querySelector('[data-testid="appearance-theme-saved"]')).not.toBeNull();
  });

  it('rejects a non-theme file with an error hint', async () => {
    const h = mount();
    await settle();
    vi.mocked(h.files.openForRead).mockResolvedValueOnce({
      name: 'bad.json',
      blob: new Blob(['{"not":"a theme"}']),
    });

    query<HTMLButtonElement>(h.container, 'appearance-install-theme').click();
    await settle();

    expect(h.store.get().settings.appearance?.themeLibrary ?? []).toHaveLength(0);
    expect(h.container.querySelector('[data-testid="appearance-import-error"]')).not.toBeNull();
  });

  it('selecting an installed theme sets activeThemeId', async () => {
    const h = mount();
    await settle();
    vi.mocked(h.files.openForRead).mockResolvedValueOnce(themeBlob({ themeMode: 'field' }));
    query<HTMLButtonElement>(h.container, 'appearance-install-theme').click();
    await settle();
    const installed = firstTheme(h.store);

    // Switch to a built-in, then back to the installed theme.
    const theme = query<HTMLSelectElement>(h.container, 'appearance-theme');
    theme.value = 'builtin:light';
    theme.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(h.store.get().settings.appearance?.activeThemeId).toBeUndefined();

    theme.value = `theme:${installed.id}`;
    theme.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(h.store.get().settings.appearance?.activeThemeId).toBe(installed.id);
  });

  it('editing an installed theme loads its colors and clears activeThemeId', async () => {
    const h = mount();
    await settle();
    vi.mocked(h.files.openForRead).mockResolvedValueOnce(
      themeBlob({ themeMode: 'dark', colors: { accent: '#abcabc' }, density: 'compact' }),
    );
    query<HTMLButtonElement>(h.container, 'appearance-install-theme').click();
    await settle();
    const installed = firstTheme(h.store);
    expect(h.store.get().settings.appearance?.activeThemeId).toBe(installed.id);

    query<HTMLButtonElement>(h.container, `appearance-edit-${installed.id}`).click();
    await settle();

    const a = h.store.get().settings.appearance;
    expect(a?.activeThemeId).toBeUndefined();
    expect(a?.themeMode).toBe('dark');
    expect(a?.colors?.accent).toBe('#abcabc');
    expect(a?.density).toBe('compact');
  });

  it('saves the inline appearance back into a theme bundle', async () => {
    const h = mount();
    await settle();
    vi.mocked(h.files.openForRead).mockResolvedValueOnce(themeBlob({ themeMode: 'dark' }));
    query<HTMLButtonElement>(h.container, 'appearance-install-theme').click();
    await settle();
    const installed = firstTheme(h.store);

    // Edit (clears active id), tweak a color, then save changes back.
    query<HTMLButtonElement>(h.container, `appearance-edit-${installed.id}`).click();
    await settle();
    const accent = query<HTMLInputElement>(h.container, 'appearance-color-accent');
    accent.value = '#010203';
    accent.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();

    query<HTMLButtonElement>(h.container, `appearance-save-${installed.id}`).click();
    await settle();
    expect(firstTheme(h.store).bundle.colors?.accent).toBe('#010203');
  });

  it('uninstalls a theme and clears the active id when it was selected', async () => {
    const h = mount();
    await settle();
    vi.mocked(h.files.openForRead).mockResolvedValueOnce(themeBlob({ themeMode: 'dark' }));
    query<HTMLButtonElement>(h.container, 'appearance-install-theme').click();
    await settle();
    const installed = firstTheme(h.store);
    expect(h.store.get().settings.appearance?.activeThemeId).toBe(installed.id);

    query<HTMLButtonElement>(h.container, `appearance-uninstall-${installed.id}`).click();
    await settle();
    expect(h.store.get().settings.appearance?.themeLibrary ?? []).toHaveLength(0);
    expect(h.store.get().settings.appearance?.activeThemeId).toBeUndefined();
    expect(h.container.querySelector('[data-testid="appearance-no-installed"]')).not.toBeNull();
  });
});
