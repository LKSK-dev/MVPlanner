/**
 * Unit tests for the T7.1 extension host (spec plan/06 §6.2/§6.3).
 *
 * Pure / in-process: a fake {@link KvStore} (Map), the trivial in-process
 * runtime, a fake module, and a minimal fake {@link ExtContext} factory that
 * wires `onDispose`/`timers`/`storage` into the host-provided
 * {@link DisposeRegistry} + scoped store. Covers manifest validation, the
 * semver-range matcher, install/persist/list/get/uninstall, enable/disable,
 * lazy activation events, dispose-registry teardown, hot reload, and error
 * isolation.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ExtContext, ExtManifest, KvStore } from '../../src/contracts';
import {
  DisposeRegistry,
  ExtManifestError,
  ExtensionHost,
  createInProcessRuntime,
  isApiVersionCompatible,
  parseManifest,
  satisfiesRange,
  type ContextFactory,
  type ExtContextInput,
  type ExtModule,
} from '../../src/ext/host';

/** In-memory {@link KvStore} keyed by `ns\0key`. */
function fakeKv(): KvStore & { size: () => number } {
  const store = new Map<string, unknown>();
  const k = (ns: string, key: string): string => `${ns}\u0000${key}`;
  return {
    get<T>(ns: string, key: string): Promise<T | undefined> {
      return Promise.resolve(store.get(k(ns, key)) as T | undefined);
    },
    set<T>(ns: string, key: string, v: T): Promise<void> {
      store.set(k(ns, key), v);
      return Promise.resolve();
    },
    del(ns: string, key: string): Promise<void> {
      store.delete(k(ns, key));
      return Promise.resolve();
    },
    size: () => store.size,
  };
}

/** Minimal fake {@link ExtContext} that routes lifecycle plumbing to the host. */
function fakeContextFactory(): ContextFactory {
  return (input: ExtContextInput): ExtContext => ({
    version: '1.0.0',
    connection: { state: () => ({ kind: 'closed' }), on: () => () => undefined },
    vehicles: {
      list: () => [],
      active: () => {
        throw new Error('no active vehicle in test');
      },
      on: () => () => undefined,
    },
    mavlink: {
      on: () => () => undefined,
      latest: () => undefined,
      rate: () => 0,
      requestInterval: () => undefined,
    },
    storage: {
      get: <T>(key: string): Promise<T | undefined> => input.storage.get<T>(key),
      set: <T>(key: string, value: T): Promise<void> => input.storage.set<T>(key, value),
    },
    notify: { info: () => undefined, warn: () => undefined, error: () => undefined },
    log: { info: () => undefined, warn: () => undefined, error: () => undefined },
    timers: {
      setInterval: (fn: () => void, ms: number): (() => void) => input.dispose.setInterval(fn, ms),
      raf: (fn: () => void): (() => void) => input.dispose.raf(fn),
    },
    events: { on: () => () => undefined, emit: () => undefined },
    onDispose: (fn: () => void): void => {
      input.dispose.add(fn);
    },
  });
}

const baseManifest = (over: Partial<ExtManifest> = {}): ExtManifest => ({
  id: 'com.example.hello',
  name: 'Hello',
  version: '1.0.0',
  apiVersion: '^1.0',
  permissions: ['telemetry:read'],
  ...over,
});

function makeModule(
  manifest: ExtManifest,
  hooks: { activate?: ExtModule['activate']; deactivate?: ExtModule['deactivate'] } = {},
): ExtModule {
  return {
    manifest,
    ...(hooks.activate ? { activate: hooks.activate } : {}),
    ...(hooks.deactivate ? { deactivate: hooks.deactivate } : {}),
  };
}

function makeHost(): ExtensionHost {
  return new ExtensionHost({
    storage: fakeKv(),
    runtime: createInProcessRuntime(),
    createContext: fakeContextFactory(),
    now: () => 1_000,
  });
}

describe('semver range matcher', () => {
  it('matches exact, caret, tilde, x-range, and comparators', () => {
    expect(satisfiesRange('1.2.3', '1.2.3')).toBe(true);
    expect(satisfiesRange('1.2.4', '1.2.3')).toBe(false);
    expect(satisfiesRange('1.4.0', '^1.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '^1.0')).toBe(false);
    expect(satisfiesRange('0.2.9', '^0.2.0')).toBe(true);
    expect(satisfiesRange('0.3.0', '^0.2.0')).toBe(false);
    expect(satisfiesRange('1.2.9', '~1.2.0')).toBe(true);
    expect(satisfiesRange('1.3.0', '~1.2.0')).toBe(false);
    expect(satisfiesRange('1.9.9', '1.x')).toBe(true);
    expect(satisfiesRange('2.0.0', '1.x')).toBe(false);
    expect(satisfiesRange('1.5.0', '>=1.0.0 <2.0.0')).toBe(true);
    expect(satisfiesRange('2.0.0', '>=1.0.0 <2.0.0')).toBe(false);
    expect(satisfiesRange('3.1.4', '*')).toBe(true);
  });

  it('ignores prerelease so a pre-release host API behaves like its release', () => {
    expect(satisfiesRange('1.0.0-pre', '^1.0')).toBe(true);
    expect(isApiVersionCompatible('^1.0', '1.0.0-pre')).toBe(true);
    expect(isApiVersionCompatible('^2.0', '1.0.0-pre')).toBe(false);
  });

  it('throws on a malformed version', () => {
    expect(() => satisfiesRange('not.a.version', '^1.0')).toThrow(ExtManifestError);
  });
});

describe('manifest validation', () => {
  it('parses a good manifest, preserving optional fields', () => {
    const m = parseManifest(baseManifest({ description: 'hi', author: 'me' }));
    expect(m.id).toBe('com.example.hello');
    expect(m.permissions).toEqual(['telemetry:read']);
    expect(m.description).toBe('hi');
  });

  it('rejects a missing required field', () => {
    const bad = { ...baseManifest() } as Record<string, unknown>;
    delete bad.name;
    expect(() => parseManifest(bad)).toThrow(/manifest\.name is required/);
  });

  it('rejects an unknown permission scope', () => {
    expect(() => parseManifest(baseManifest({ permissions: ['bogus' as never] }))).toThrow(
      /unknown scope/,
    );
  });

  it('accepts a net:<host> permission', () => {
    const m = parseManifest(baseManifest({ permissions: ['net:example.com'] }));
    expect(m.permissions).toEqual(['net:example.com']);
  });

  it('rejects a non-semver version', () => {
    expect(() => parseManifest(baseManifest({ version: 'one' }))).toThrow(ExtManifestError);
  });
});

describe('install / persist / list / get / uninstall', () => {
  it('installs, persists, lists, gets, and uninstalls', async () => {
    const storage = fakeKv();
    const host = new ExtensionHost({
      storage,
      runtime: createInProcessRuntime(),
      createContext: fakeContextFactory(),
      now: () => 42,
    });

    const manifest = baseManifest();
    const state = await host.install({ manifest, code: '// src', module: makeModule(manifest) });
    expect(state.status).toBe('installed');
    expect(state.installedAt).toBe(42);

    expect(host.list().map((e) => e.id)).toEqual(['com.example.hello']);
    expect(host.get('com.example.hello')?.manifest.name).toBe('Hello');

    // Persistence survives a fresh host over the same storage (no module restored).
    const host2 = new ExtensionHost({
      storage,
      runtime: createInProcessRuntime(),
      createContext: fakeContextFactory(),
    });
    await host2.restore();
    expect(host2.get('com.example.hello')?.status).toBe('installed');

    await host.uninstall('com.example.hello');
    expect(host.get('com.example.hello')).toBeUndefined();

    const host3 = new ExtensionHost({
      storage,
      runtime: createInProcessRuntime(),
      createContext: fakeContextFactory(),
    });
    await host3.restore();
    expect(host3.list()).toEqual([]);
  });

  it('rejects an incompatible apiVersion at install', async () => {
    const host = makeHost();
    const manifest = baseManifest({ apiVersion: '^2.0' });
    await expect(host.install({ manifest, module: makeModule(manifest) })).rejects.toThrow(
      /incompatible/,
    );
  });

  it('clears per-extension KV on uninstall', async () => {
    const host = makeHost();
    const manifest = baseManifest();
    await host.install({ manifest, module: makeModule(manifest) });
    await host.extStorage('com.example.hello').set('k', 1);
    expect(await host.extStorage('com.example.hello').get('k')).toBe(1);
    await host.uninstall('com.example.hello');
    expect(await host.extStorage('com.example.hello').get('k')).toBeUndefined();
  });
});

describe('enable / disable', () => {
  it('disable deactivates an active extension; enable keeps it lazy', async () => {
    const host = makeHost();
    const activate = vi.fn();
    const manifest = baseManifest();
    await host.install({ manifest, module: makeModule(manifest, { activate }) });

    await host.fireActivationEvent('onStartup');
    expect(activate).toHaveBeenCalledTimes(1);
    expect(host.get('com.example.hello')?.status).toBe('active');

    const disabled = await host.disable('com.example.hello');
    expect(disabled.status).toBe('disabled');
    expect(disabled.enabled).toBe(false);

    const enabled = await host.enable('com.example.hello');
    expect(enabled.status).toBe('installed'); // lazy: not re-activated by enable
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('does not activate a disabled extension on its event', async () => {
    const host = makeHost();
    const activate = vi.fn();
    const manifest = baseManifest();
    await host.install({ manifest, module: makeModule(manifest, { activate }), enabled: false });
    await host.fireActivationEvent('onStartup');
    expect(activate).not.toHaveBeenCalled();
    expect(host.get('com.example.hello')?.status).toBe('disabled');
  });
});

describe('activation events', () => {
  it('activates lazily on onCommand and onMessage, only once', async () => {
    const host = makeHost();
    const activate = vi.fn();
    const manifest = baseManifest({
      contributes: { commands: [{ id: 'do.it', title: 'Do it' }] },
    });
    await host.install({
      manifest,
      module: makeModule(manifest, { activate }),
      activationEvents: ['onCommand:do.it', 'onMessage:HEARTBEAT'],
    });

    // Unrelated event does nothing.
    expect(await host.fireActivationEvent('onCommand:other')).toEqual([]);
    expect(activate).not.toHaveBeenCalled();

    const activated = await host.fireActivationEvent('onCommand:do.it');
    expect(activated.map((e) => e.id)).toEqual(['com.example.hello']);
    expect(activate).toHaveBeenCalledTimes(1);

    // A second matching event is a no-op (already active).
    await host.fireActivationEvent('onMessage:HEARTBEAT');
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('derives onCommand events from contributed commands by default', async () => {
    const host = makeHost();
    const activate = vi.fn();
    const manifest = baseManifest({
      contributes: { commands: [{ id: 'cmd.run', title: 'Run' }] },
    });
    await host.install({ manifest, module: makeModule(manifest, { activate }) });
    expect(host.get('com.example.hello')?.activationEvents).toEqual(['onCommand:cmd.run']);
    await host.fireActivationEvent('onCommand:cmd.run');
    expect(activate).toHaveBeenCalledTimes(1);
  });
});

describe('dispose registry', () => {
  it('tears down ctx.onDispose registrations on deactivate', async () => {
    const host = makeHost();
    const cleanup = vi.fn();
    const manifest = baseManifest();
    await host.install({
      manifest,
      module: makeModule(manifest, {
        activate: (ctx: ExtContext) => {
          ctx.onDispose(cleanup);
        },
      }),
    });

    await host.activate('com.example.hello');
    expect(cleanup).not.toHaveBeenCalled();

    await host.deactivate('com.example.hello');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(host.get('com.example.hello')?.status).toBe('installed');
  });

  it('runs cleanups once, LIFO, isolating faults (standalone)', () => {
    const order: number[] = [];
    const reg = new DisposeRegistry();
    reg.add(() => order.push(1));
    reg.add(() => {
      throw new Error('boom');
    });
    reg.add(() => order.push(3));
    expect(reg.size).toBe(3);
    reg.dispose();
    expect(order).toEqual([3, 1]);
    expect(reg.disposed).toBe(true);
    reg.dispose(); // idempotent
    expect(order).toEqual([3, 1]);
  });
});

describe('hot reload', () => {
  it('re-runs deactivate + activate cleanly', async () => {
    const host = makeHost();
    const activate = vi.fn();
    const deactivate = vi.fn();
    const manifest = baseManifest();
    await host.install({ manifest, module: makeModule(manifest, { activate, deactivate }) });
    await host.activate('com.example.hello');
    expect(activate).toHaveBeenCalledTimes(1);

    const reloaded = await host.reload('com.example.hello');
    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(activate).toHaveBeenCalledTimes(2);
    expect(reloaded.status).toBe('active');
  });

  it('swaps in new source on reload', async () => {
    const host = makeHost();
    const m1 = baseManifest({ name: 'Old' });
    await host.install({ manifest: m1, module: makeModule(m1) });
    const m2 = baseManifest({ name: 'New', version: '1.1.0' });
    const reloaded = await host.reload('com.example.hello', {
      manifest: m2,
      module: makeModule(m2),
    });
    expect(reloaded.manifest.name).toBe('New');
    expect(reloaded.manifest.version).toBe('1.1.0');
  });
});

describe('error isolation', () => {
  it('marks a throwing activate as error without crashing the host', async () => {
    const host = makeHost();
    const manifest = baseManifest();
    await host.install({
      manifest,
      module: makeModule(manifest, {
        activate: () => {
          throw new Error('activate blew up');
        },
      }),
    });

    // fireActivationEvent must resolve (host survives), not reject.
    const activated = await host.fireActivationEvent('onStartup');
    expect(activated).toEqual([]);
    const state = host.get('com.example.hello');
    expect(state?.status).toBe('error');
    expect(state?.error).toMatch(/activate blew up/);

    // An errored extension is not re-activated by further events.
    await host.fireActivationEvent('onStartup');
    expect(host.get('com.example.hello')?.status).toBe('error');
  });

  it('surfaces a module-less in-process load as an error', async () => {
    const host = makeHost();
    const manifest = baseManifest();
    await host.install({ manifest, code: '// no module here' });
    await host.fireActivationEvent('onStartup');
    expect(host.get('com.example.hello')?.status).toBe('error');
  });
});
