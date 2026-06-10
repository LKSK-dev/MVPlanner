/**
 * Live keybind bridge tests (audit D5). `createLiveKeybinds` must read
 * `settings.keybinds` LIVE from the store on every build — a settings-bundle
 * import patched into the store takes effect immediately — layering only
 * transient unsaved edits on top; `persist()` writes the merge and clears the
 * diff.
 */
import { describe, expect, it } from 'vitest';
import type { CommandDef } from '../../src/contracts';
import { createAppStore } from '../../src/core/store';
import { createLiveKeybinds } from '../../src/ui/shell/appsettings/live-keybinds';

/** Await the store's coalesced microtask flush. */
const settle = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const commands: readonly CommandDef[] = [
  { id: 'a', title: 'Cmd A', shortcut: 'mod+k', run: () => undefined },
  { id: 'b', title: 'Cmd B', run: () => undefined },
];

describe('createLiveKeybinds (live store reads)', () => {
  it('reflects a store patch to settings.keybinds immediately (bundle import)', async () => {
    const store = createAppStore();
    const { registry } = createLiveKeybinds(() => commands, store);
    expect(registry.chordFor('a')).toBe('mod+k');

    store.patch((d) => {
      d.settings.keybinds = { a: 'mod+p' };
    });
    await settle();
    expect(registry.chordFor('a')).toBe('mod+p');
    expect(registry.resolve('mod+p')).toBe('a');
  });

  it('layers unsaved edits over the live store value until persist()', async () => {
    const store = createAppStore();
    const { registry, persist } = createLiveKeybinds(() => commands, store);

    expect(registry.setOverride('b', 'mod+j')).toBe(true);
    // Unsaved edit visible, store untouched.
    expect(registry.chordFor('b')).toBe('mod+j');
    expect(store.get().settings.keybinds?.['b']).toBeUndefined();

    // A concurrent store patch (import) still shows through for other ids.
    store.patch((d) => {
      d.settings.keybinds = { a: 'mod+p' };
    });
    await settle();
    expect(registry.chordFor('a')).toBe('mod+p');
    expect(registry.chordFor('b')).toBe('mod+j');

    persist();
    await settle();
    expect(store.get().settings.keybinds).toEqual({ a: 'mod+p', b: 'mod+j' });

    // The diff is cleared: a later import wins again.
    store.patch((d) => {
      d.settings.keybinds = { b: 'mod+u' };
    });
    await settle();
    expect(registry.chordFor('b')).toBe('mod+u');
  });

  it('clearOverride and clearAll act on the live merge', async () => {
    const store = createAppStore();
    store.patch((d) => {
      d.settings.keybinds = { a: 'mod+p', b: 'mod+j' };
    });
    await settle();
    const { registry, persist } = createLiveKeybinds(() => commands, store);

    registry.clearOverride('b');
    expect(registry.chordFor('b')).toBeUndefined();
    expect(registry.chordFor('a')).toBe('mod+p');

    registry.clearAll();
    expect(registry.chordFor('a')).toBe('mod+k'); // back to default

    persist();
    await settle();
    expect(store.get().settings.keybinds).toEqual({});
  });
});
