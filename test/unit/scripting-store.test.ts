/**
 * Scripting store + macro-binding tests (task T7.4; spec plan/06 §6.7).
 *
 * Pure: a fake in-memory {@link KvStore} backs the snippet / macro / grant
 * stores; covers save/list/get/remove + export/import round-trips, the
 * user-controlled grant profile (defaults + toggle), and {@link bindMacros}
 * registering a command-triggered macro on a fake registry + subscribing an
 * event-triggered macro.
 */
import { describe, it, expect, vi } from 'vitest';
import type { CommandDef, KvStore, UiRegistry } from '../../src/contracts';
import {
  type Macro,
  bindMacros,
  createMacroStore,
  createScriptingGrantStore,
  createSnippetStore,
  extractApiMembers,
  DEFAULT_SCRIPTING_GRANTS,
} from '../../src/ext/scripting';
import { buildExtApiDts } from '../../src/ext/api';

function fakeKv(): KvStore {
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
  };
}

describe('snippet store', () => {
  it('saves, lists, gets and removes', async () => {
    let id = 0;
    const store = createSnippetStore({
      storage: fakeKv(),
      now: () => 1000,
      genId: () => `s${++id}`,
    });

    const a = await store.save({ name: 'Beta', code: 'return 2' });
    const b = await store.save({ name: 'Alpha', code: 'return 1' });
    expect(a.id).toBe('s1');
    expect(b.createdMs).toBe(1000);

    const list = await store.list();
    expect(list.map((s) => s.name)).toEqual(['Alpha', 'Beta']); // sorted by name

    expect((await store.get('s1'))?.code).toBe('return 2');

    await store.remove('s1');
    expect(await store.get('s1')).toBeUndefined();
    expect(await store.list()).toHaveLength(1);
  });

  it('updates an existing snippet and preserves createdMs', async () => {
    let t = 1000;
    const store = createSnippetStore({ storage: fakeKv(), now: () => t, genId: () => 'fixed' });
    const created = await store.save({ name: 'X', code: 'a' });
    t = 2000;
    const updated = await store.save({ id: created.id, name: 'X2', code: 'b' });
    expect(updated.id).toBe('fixed');
    expect(updated.createdMs).toBe(1000);
    expect(updated.updatedMs).toBe(2000);
    expect(updated.name).toBe('X2');
    expect(await store.list()).toHaveLength(1);
  });

  it('round-trips export/import', async () => {
    const src = createSnippetStore({ storage: fakeKv(), genId: () => 'e1' });
    await src.save({ name: 'Exported', code: 'return 7' });
    const dump = await src.export();
    expect(dump.kind).toBe('mvplanner.snippets');

    const dst = createSnippetStore({ storage: fakeKv() });
    const imported = await dst.import(dump);
    expect(imported).toHaveLength(1);
    expect((await dst.list())[0]?.code).toBe('return 7');
    expect(await dst.import({ nope: true })).toEqual([]);
  });
});

describe('grant store', () => {
  it('returns safe defaults until set', async () => {
    const store = createScriptingGrantStore({ storage: fakeKv() });
    expect(await store.list()).toEqual([...DEFAULT_SCRIPTING_GRANTS]);
  });

  it('toggles a permission on and off', async () => {
    const store = createScriptingGrantStore({ storage: fakeKv() });
    const withCmd = await store.toggle('command', true);
    expect(withCmd).toContain('command');
    const again = await store.toggle('command', true);
    expect(again.filter((p) => p === 'command')).toHaveLength(1); // idempotent
    const without = await store.toggle('command', false);
    expect(without).not.toContain('command');
  });
});

describe('macro store + bindMacros', () => {
  it('saves and exports macros', async () => {
    const store = createMacroStore({ storage: fakeKv(), genId: () => 'm1' });
    const macro = await store.save({
      name: 'On connect',
      code: "mvp.notify.info('connected')",
      trigger: { kind: 'event', event: 'connect' },
    });
    expect(macro.id).toBe('m1');
    expect(macro.enabled).toBe(true);
    const dump = await store.export();
    expect(dump.macros).toHaveLength(1);
  });

  it('binds a command-triggered macro to the registry', async () => {
    const registry: Pick<UiRegistry, 'registerCommand'> = {
      registerCommand: vi.fn<UiRegistry['registerCommand']>(() => () => undefined),
    };
    const run = vi.fn<(m: Macro) => void>();
    const macro: Macro = {
      id: 'm1',
      name: 'Arm',
      code: 'mvp.command.arm(true)',
      trigger: { kind: 'command', commandId: 'macro.arm', title: 'Arm vehicle', shortcut: 'Mod-a' },
      enabled: true,
    };

    const dispose = bindMacros([macro], { registry, run });
    expect(registry.registerCommand).toHaveBeenCalledTimes(1);

    const def = vi.mocked(registry.registerCommand).mock.calls[0]?.[0] as CommandDef;
    expect(def.id).toBe('macro.arm');
    expect(def.title).toBe('Arm vehicle');
    expect(def.shortcut).toBe('Mod-a');

    void def.run();
    expect(run).toHaveBeenCalledWith(macro);

    dispose();
  });

  it('binds an event-triggered macro and skips disabled macros', () => {
    const registry: Pick<UiRegistry, 'registerCommand'> = {
      registerCommand: vi.fn<UiRegistry['registerCommand']>(() => () => undefined),
    };
    const handlers = new Map<string, () => void>();
    const events = {
      on: vi.fn((event: string, cb: () => void) => {
        handlers.set(event, cb);
        return () => handlers.delete(event);
      }),
    };
    const run = vi.fn<(m: Macro) => void>();
    const onConnect: Macro = {
      id: 'm2',
      name: 'OnConnect',
      code: 'x',
      trigger: { kind: 'event', event: 'connect' },
      enabled: true,
    };
    const disabled: Macro = {
      id: 'm3',
      name: 'Off',
      code: 'y',
      trigger: { kind: 'command', commandId: 'c', title: 'C' },
      enabled: false,
    };

    bindMacros([onConnect, disabled], { registry, run, events });
    expect(events.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(registry.registerCommand).not.toHaveBeenCalled(); // disabled skipped

    handlers.get('connect')?.();
    expect(run).toHaveBeenCalledWith(onConnect);
  });
});

describe('extractApiMembers', () => {
  it('surfaces the top-level mvp surface from the bundled .d.ts', () => {
    const members = extractApiMembers(buildExtApiDts());
    const names = members.map((m) => m.name);
    expect(names).toContain('mavlink');
    expect(names).toContain('params');
    expect(names).toContain('onDispose');
    expect(members.find((m) => m.name === 'onDispose')?.kind).toBe('method');
    expect(members.find((m) => m.name === 'command')?.optional).toBe(true);
    // nested members (e.g. `state`, `latest`) must NOT leak to the top level
    expect(names).not.toContain('latest');
  });
});
