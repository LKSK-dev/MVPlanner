/**
 * Workspace preset tests (UI remake Phase 2/3): default layout has all six
 * screen presets; ensurePresets is idempotent + additive; reset restores a preset.
 */
import { describe, expect, it } from 'vitest';
import { defaultLayout, ensurePresets, resetWorkspaceToPreset } from '../../src/ui/shell/presets';
import { makePanel, type ShellLayout } from '../../src/ui/shell/workspace';
import { SCREEN_ORDER } from '../../src/ui/shell/screens';

const nameFor = (id: string): string => `Name:${id}`;

describe('workspace presets', () => {
  it('defaultLayout has a workspace per screen', () => {
    const layout = defaultLayout(nameFor);
    for (const id of SCREEN_ORDER) expect(layout.workspaces[id]).toBeDefined();
    expect(layout.activeWorkspaceId).toBe(SCREEN_ORDER[0]);
    expect(layout.schemaVersion).toBe(2);
  });

  it('ensurePresets adds missing presets, preserves custom workspaces + edits', () => {
    const partial: ShellLayout = {
      activeWorkspaceId: 'custom',
      order: ['custom'],
      workspaces: {
        custom: { id: 'custom', name: 'My WS', root: makePanel('w.x', 'x') },
        flight: { id: 'flight', name: 'Edited Flight', root: makePanel('w.map', 'm') },
      },
    };
    const out = ensurePresets(partial, nameFor);
    // custom + edited flight kept; the other five presets added.
    expect(out.workspaces['custom']?.name).toBe('My WS');
    expect(out.workspaces['flight']?.name).toBe('Edited Flight');
    for (const id of SCREEN_ORDER) expect(out.workspaces[id]).toBeDefined();
    // idempotent
    expect(Object.keys(ensurePresets(out, nameFor).workspaces).sort()).toEqual(
      Object.keys(out.workspaces).sort(),
    );
  });

  it('fixes an invalid active workspace id', () => {
    const out = ensurePresets({ activeWorkspaceId: 'gone', order: [], workspaces: {} }, nameFor);
    expect(out.workspaces[out.activeWorkspaceId]).toBeDefined();
  });

  it('resetWorkspaceToPreset restores the preset root', () => {
    const edited = defaultLayout(nameFor);
    const mutated: ShellLayout = {
      ...edited,
      workspaces: {
        ...edited.workspaces,
        flight: { id: 'flight', name: 'Flight', root: makePanel('w.custom', 'c') },
      },
    };
    const reset = resetWorkspaceToPreset(mutated, 'flight', 'Flight');
    expect((reset.workspaces['flight']?.root as { widgetId?: string }).widgetId).toBe(
      'screen.flight',
    );
    // unknown screen id is a no-op
    expect(resetWorkspaceToPreset(mutated, 'nope', 'X')).toBe(mutated);
  });
});
