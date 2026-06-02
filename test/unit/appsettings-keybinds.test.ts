/**
 * App Settings → Keybinds section tests (spec docs/appsettings §5.4/§7.5).
 *
 * Renders {@link KeybindsSection} over a REAL {@link KeybindRegistry} and
 * exercises the rebind contract: rows render, clicking a command's chord then
 * pressing a combination binds it (and persists), and Reset clears the override.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createComponent } from 'solid-js';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { t } from '../../src/core/i18n';
import { createKeybindRegistry } from '../../src/core/keybinds';
import '../../src/ui/shell/appsettings/messages'; // register appsettings.* strings
import { KeybindsSection } from '../../src/ui/shell/appsettings/sections/keybinds';
import type { AppSettingsSectionDeps } from '../../src/ui/shell/appsettings/context';

afterEach(cleanup);

function mount(): {
  container: HTMLElement;
  registry: ReturnType<typeof createKeybindRegistry>;
  persistKeybinds: ReturnType<typeof vi.fn>;
} {
  const registry = createKeybindRegistry({
    commands: [
      { id: 'a', title: 'Cmd A', shortcut: 'mod+k' },
      { id: 'b', title: 'Cmd B' },
    ],
  });
  const persistKeybinds = vi.fn();
  const deps = {
    keybinds: registry,
    persistKeybinds,
    t,
  } as unknown as AppSettingsSectionDeps;
  const { container } = render(() => createComponent(KeybindsSection, { deps }));
  return { container, registry, persistKeybinds };
}

describe('AppSettings Keybinds section', () => {
  it('renders a row per command', () => {
    const { container } = mount();
    expect(container.textContent).toContain('Cmd A');
    expect(container.textContent).toContain('Cmd B');
    // Cmd A shows its default chord; Cmd B is unbound.
    expect(container.querySelector('[data-testid="keybind-chord-a"]')?.textContent).toContain('K');
    expect(container.querySelector('[data-testid="keybind-chord-b"]')?.textContent).toBe(
      t('appsettings.keybinds.unbound'),
    );
  });

  it('binds a captured chord and persists it', () => {
    const { container, registry, persistKeybinds } = mount();
    const chordBtn = container.querySelector('[data-testid="keybind-chord-b"]') as HTMLElement;
    fireEvent.click(chordBtn);
    fireEvent.keyDown(chordBtn, { key: '1', ctrlKey: true });

    expect(registry.chordFor('b')).toBe('mod+1');
    expect(persistKeybinds).toHaveBeenCalled();
  });

  it('rejects a conflicting chord and does not bind', () => {
    const { container, registry, persistKeybinds } = mount();
    const chordBtn = container.querySelector('[data-testid="keybind-chord-b"]') as HTMLElement;
    fireEvent.click(chordBtn);
    // mod+k already belongs to Cmd A.
    fireEvent.keyDown(chordBtn, { key: 'k', ctrlKey: true });

    expect(registry.chordFor('b')).toBeUndefined();
    expect(persistKeybinds).not.toHaveBeenCalled();
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Cmd A');
  });

  it('resets a single override back to its default', () => {
    const { container, registry, persistKeybinds } = mount();
    const chordBtn = container.querySelector('[data-testid="keybind-chord-b"]') as HTMLElement;
    fireEvent.click(chordBtn);
    fireEvent.keyDown(chordBtn, { key: '1', ctrlKey: true });
    expect(registry.chordFor('b')).toBe('mod+1');

    const resetBtn = container.querySelector('[data-testid="keybind-reset-b"]') as HTMLElement;
    fireEvent.click(resetBtn);

    expect(registry.chordFor('b')).toBeUndefined();
    expect(persistKeybinds).toHaveBeenCalledTimes(2);
  });

  it('reset all clears every override', () => {
    const { container, registry } = mount();
    const chordBtn = container.querySelector('[data-testid="keybind-chord-b"]') as HTMLElement;
    fireEvent.click(chordBtn);
    fireEvent.keyDown(chordBtn, { key: '1', ctrlKey: true });
    expect(registry.chordFor('b')).toBe('mod+1');

    const resetAll = container.querySelector('[data-testid="keybind-reset-all"]') as HTMLElement;
    fireEvent.click(resetAll);
    expect(registry.chordFor('b')).toBeUndefined();
  });
});
