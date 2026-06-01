/**
 * Scripting-console controller tests (task T7.4; spec plan/06 §6.7).
 *
 * Exercises the injectable `{ makeContext, storage, registry }` orchestration
 * WITHOUT an editor: running code builds `mvp` from the current grant profile;
 * snippet save/list/run; grant toggles flow into the next `makeContext`; and a
 * saved command-macro binds to the registry and runs its code against `mvp`.
 */
import { describe, it, expect, vi } from 'vitest';
import type {
  CommandDef,
  ExtContext,
  KvStore,
  Param,
  Permission,
  UiRegistry,
} from '../../src/contracts';
import { createConsoleController } from '../../src/ui/widgets/console';

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

function fakeContext(notifications: string[]): ExtContext {
  const param: Param = { name: 'A', value: 5, type: 9 };
  return {
    notify: {
      info: (m: string): void => void notifications.push(m),
      warn: (): void => undefined,
      error: (): void => undefined,
    },
    params: { get: (): Param => param },
  } as unknown as ExtContext;
}

describe('console controller', () => {
  it('runs code under the current grant profile', async () => {
    const notes: string[] = [];
    const makeContext = vi.fn((_g: readonly Permission[]) => fakeContext(notes));
    const controller = createConsoleController({ makeContext, storage: fakeKv() });

    const result = await controller.run('return 1 + 1');
    expect(result.ok).toBe(true);
    expect(result.value).toBe(2);
    // makeContext was handed the default safe grants
    expect(makeContext).toHaveBeenCalledTimes(1);
    expect(makeContext.mock.calls[0]?.[0]).toEqual(['telemetry:read', 'notify', 'storage']);
  });

  it('passes toggled grants to makeContext on the next run', async () => {
    const makeContext = vi.fn((_g: readonly Permission[]) => fakeContext([]));
    const controller = createConsoleController({ makeContext, storage: fakeKv() });

    await controller.grants.toggle('command', true);
    await controller.run('return 0');
    expect(makeContext.mock.calls.at(-1)?.[0]).toContain('command');
  });

  it('saves, lists and runs a snippet', async () => {
    const makeContext = vi.fn(() => fakeContext([]));
    const controller = createConsoleController({
      makeContext,
      storage: fakeKv(),
      genId: () => 'snip1',
    });

    const saved = await controller.snippets.save({ name: 'Double', code: 'return 21 * 2' });
    expect((await controller.snippets.list()).map((s) => s.name)).toEqual(['Double']);

    const result = await controller.runSnippet(saved.id);
    expect(result.value).toBe(42);
  });

  it('binds a saved command-macro to the registry and runs it', async () => {
    const notes: string[] = [];
    const makeContext = vi.fn(() => fakeContext(notes));
    const registry: Pick<UiRegistry, 'registerCommand'> = {
      registerCommand: vi.fn<UiRegistry['registerCommand']>(() => () => undefined),
    };
    const controller = createConsoleController({
      makeContext,
      storage: fakeKv(),
      registry,
      genId: () => 'macro1',
    });

    const macro = await controller.macros.save({
      name: 'Notify',
      code: "mvp.notify.info('macro ran')",
      trigger: { kind: 'command', commandId: 'macro.notify', title: 'Notify' },
    });

    const dispose = await controller.bindSavedMacros();
    expect(registry.registerCommand).toHaveBeenCalledTimes(1);
    const def = vi.mocked(registry.registerCommand).mock.calls[0]?.[0] as CommandDef;
    expect(def.id).toBe('macro.notify');

    // Running the macro executes its code against the built mvp.
    await controller.runMacro(macro);
    expect(notes).toEqual(['macro ran']);

    dispose();
  });

  it('throws when binding macros without a registry', async () => {
    const controller = createConsoleController({
      makeContext: () => fakeContext([]),
      storage: fakeKv(),
    });
    await expect(controller.bindSavedMacros()).rejects.toThrow(/registry/);
  });
});
