/**
 * Focused sanity-check tests for the Hello World example extension.
 *
 * Verifies the bundled module loads, declares a valid host-parseable manifest
 * with minimal permissions, and — when activated against a fake extension
 * context — contributes the top-bar clickable box plus a command-palette entry
 * whose `run()` shows the "Hello World!" overlay. All registrations must dispose
 * on teardown.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CommandDef, ConfirmOptions, ExtContext } from '../../src/contracts';
import { parseManifest, isApiVersionCompatible } from '../../src/ext/host';
import { helloWorld } from '../../extensions/index.js';

interface CtxHarness {
  ctx: ExtContext;
  commands: CommandDef[];
  menuItems: { location: string; item: CommandDef }[];
  confirms: ConfirmOptions[];
  disposers: (() => void)[];
}

function fakeCtx(): CtxHarness {
  const commands: CtxHarness['commands'] = [];
  const menuItems: CtxHarness['menuItems'] = [];
  const confirms: CtxHarness['confirms'] = [];
  const disposers: CtxHarness['disposers'] = [];
  const ctx = {
    ui: {
      registerCommand: vi.fn((def: CommandDef) => {
        commands.push(def);
        return () => undefined;
      }),
      addMenuItem: vi.fn((location: string, item: CommandDef) => {
        menuItems.push({ location, item });
        return () => undefined;
      }),
      confirm: vi.fn((opts: ConfirmOptions) => {
        confirms.push(opts);
        return Promise.resolve(true);
      }),
    },
    onDispose: vi.fn((fn: () => void) => {
      disposers.push(fn);
    }),
  } as unknown as ExtContext;
  return { ctx, commands, menuItems, confirms, disposers };
}

describe('hello-world example extension', () => {
  it('is bundled and exposes activate/deactivate plus a manifest', () => {
    expect(typeof helloWorld.activate).toBe('function');
    expect(typeof helloWorld.deactivate).toBe('function');
    expect(helloWorld.manifest.id).toBe('hello-world');
  });

  it('declares a host-parseable manifest with minimal UI permission', () => {
    const manifest = parseManifest(helloWorld.manifest);
    expect(manifest.id).toBe('hello-world');
    expect(manifest.name).toBe('Hello World');
    expect(manifest.apiVersion).toBe('^1.0');
    expect(isApiVersionCompatible(manifest.apiVersion)).toBe(true);
    expect(manifest.permissions).toEqual(['ui:panel']);
    expect(manifest.contributes?.commands).toEqual([{ id: 'hello-world.greet', title: 'Hello' }]);
  });

  it('contributes a top-bar "Hello" box and a matching command-palette entry', () => {
    const harness = fakeCtx();
    helloWorld.activate?.(harness.ctx);

    const topbar = harness.menuItems.find((entry) => entry.location === 'topbar');
    expect(topbar).toBeDefined();
    expect(topbar?.item.title).toBe('Hello');
    expect(topbar?.item.id).toBe('hello-world.greet');

    expect(harness.commands.map((command) => command.id)).toEqual(['hello-world.greet']);
    // The declared command contribution is backed by a runtime registration.
    expect(harness.commands[0]?.title).toBe('Hello');
  });

  it('shows a "Hello World!" overlay when the box/command is clicked', () => {
    const harness = fakeCtx();
    helloWorld.activate?.(harness.ctx);

    const run = harness.menuItems[0]?.item.run;
    expect(run).toBeDefined();
    run?.();

    expect(harness.confirms).toHaveLength(1);
    expect(harness.confirms[0]?.title).toBe('Hello World!');
    expect(harness.confirms[0]?.body).toBe('Hello World!');
  });

  it('registers disposers for every contribution', () => {
    const harness = fakeCtx();
    helloWorld.activate?.(harness.ctx);
    // one disposer for the command, one for the menu item.
    expect(harness.disposers).toHaveLength(2);
    expect(() => harness.disposers.forEach((dispose) => dispose())).not.toThrow();
  });
});
