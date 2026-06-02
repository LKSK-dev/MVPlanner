/**
 * Keybinds section 0.3: manual text-entry fallback + capture lock.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createComponent } from 'solid-js';
import { t } from '../../src/core/i18n';
import '../../src/ui/shell/appsettings/messages';
import { KeybindsSection } from '../../src/ui/shell/appsettings/sections/keybinds';
import { createKeybindRegistry } from '../../src/core/keybinds';
import type { AppSettingsSectionDeps } from '../../src/ui/shell/appsettings';

afterEach(cleanup);

function makeDeps(over: Partial<AppSettingsSectionDeps> = {}): AppSettingsSectionDeps {
  const keybinds = createKeybindRegistry({
    commands: [
      { id: 'a', title: 'Command A', shortcut: 'mod+k' },
      { id: 'b', title: 'Command B' },
    ],
  });
  return {
    t,
    keybinds,
    persistKeybinds: vi.fn(),
    setKeybindCapturing: vi.fn(),
    ...over,
  } as unknown as AppSettingsSectionDeps;
}

describe('KeybindsSection manual entry', () => {
  it('binds a chord typed in standard syntax (Shift+1)', () => {
    const deps = makeDeps();
    const { container } = render(() => createComponent(KeybindsSection, { deps }));
    const input = container.querySelector('[data-testid="keybind-manual-b"]') as HTMLInputElement;
    input.value = 'Shift+1';
    fireEvent.change(input);
    expect(deps.keybinds.chordFor('b')).toBe('shift+1');
    expect(deps.persistKeybinds).toHaveBeenCalled();
  });

  it('rejects an invalid manual chord', () => {
    const deps = makeDeps();
    const { container } = render(() => createComponent(KeybindsSection, { deps }));
    const input = container.querySelector('[data-testid="keybind-manual-b"]') as HTMLInputElement;
    input.value = 'shift+'; // no key
    fireEvent.change(input);
    expect(deps.keybinds.chordFor('b')).toBeUndefined();
  });

  it('raises + lowers the capture lock when pressing to rebind', () => {
    const setKeybindCapturing = vi.fn();
    const deps = makeDeps({ setKeybindCapturing });
    const { container } = render(() => createComponent(KeybindsSection, { deps }));
    const chordBtn = container.querySelector(
      '[data-testid="keybind-chord-b"]',
    ) as HTMLButtonElement;
    fireEvent.click(chordBtn);
    expect(setKeybindCapturing).toHaveBeenCalledWith(true);
    fireEvent.keyDown(chordBtn, { key: '2', ctrlKey: true });
    expect(deps.keybinds.chordFor('b')).toBe('mod+2');
    expect(setKeybindCapturing).toHaveBeenLastCalledWith(false);
  });
});
