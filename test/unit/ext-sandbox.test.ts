/**
 * Unit tests for the T7.2 sandboxed runtime (spec plan/06 §6.6, plan/08 §8.3).
 *
 * In-process / no real Worker: a {@link createInProcessSpawner} backed by a
 * {@link MessageChannel} runs the guest bootstrap in-thread, so the broker +
 * `ctx` proxy round-trip is exercised without spawning a Worker (the real-Worker
 * eval path is browser/e2e-deferred). Covers: the proxy exposes only granted
 * methods, privileged calls RPC to the broker, a thrown handler is isolated,
 * the default (module) spawner, and the watchdog terminate hook.
 */
import { describe, it, expect, vi } from 'vitest';
import type { ExtContext, ExtManifest, KvStore } from '../../src/contracts';
import { createAuditLog } from '../../src/core/audit';
import { ExtensionHost, type ExtLoadRecord, type ExtModule } from '../../src/ext/host';
import {
  PermissionBroker,
  createGrantStore,
  createPermissionBroker,
  type ConfirmFn,
  type GrantStore,
} from '../../src/ext/permissions';
import {
  SandboxWatchdog,
  createInProcessSpawner,
  createSandboxRuntime,
  type GuestEvaluate,
  type SandboxCtx,
} from '../../src/ext/sandbox';

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

const manifest: ExtManifest = {
  id: 'a',
  name: 'A',
  version: '1.0.0',
  apiVersion: '^1.0',
  permissions: ['telemetry:read'],
};

/** The host-side ctx is ignored by the sandbox runtime; a stub is enough. */
const NO_CTX = {} as ExtContext;

function makeBroker(): { broker: PermissionBroker; grants: GrantStore } {
  const grants = createGrantStore(fakeKv());
  const broker = createPermissionBroker({
    grants,
    audit: createAuditLog(),
    confirm: vi.fn<ConfirmFn>(() => Promise.resolve(true)),
  });
  return { broker, grants };
}

/** Async RPC stub shape the proxy materialises for each granted method. */
type Stub = (...args: unknown[]) => Promise<unknown>;
/** Explicit (non-index) proxy node so `noUncheckedIndexedAccess` keeps methods defined. */
interface TelemetryNode {
  latest: Stub;
  boom: Stub;
}

describe('in-process sandbox proxy', () => {
  it('exposes only granted methods and RPCs them to the broker', async () => {
    const { broker, grants } = makeBroker();
    const latest = vi.fn((extId: string, args: readonly unknown[]) =>
      Promise.resolve({ extId, args }),
    );
    broker.registerApi('telemetry.latest', 'telemetry:read', latest);
    broker.registerApi('command.arm', 'command', () => Promise.resolve('armed'));
    broker.registerApi('log.info', null, () => Promise.resolve(undefined));
    await grants.grant('a', ['telemetry:read']);

    let captured: SandboxCtx | undefined;
    let result: unknown;
    const evaluate: GuestEvaluate = () => ({
      activate: async (ctx: SandboxCtx): Promise<void> => {
        captured = ctx;
        const telemetry = ctx.telemetry as TelemetryNode;
        result = await telemetry.latest('HEARTBEAT');
      },
    });

    const runtime = createSandboxRuntime({ broker, spawn: createInProcessSpawner({ evaluate }) });
    const loaded = await runtime.load({ id: 'a', manifest, code: '' });
    await loaded.activate(NO_CTX);

    // Granted + null-required methods present; ungranted absent.
    expect(captured).toBeDefined();
    expect(typeof (captured?.telemetry as TelemetryNode).latest).toBe('function');
    expect(captured?.log).toBeDefined();
    expect(captured?.command).toBeUndefined();

    // The privileged call reached the broker handler with the ext id + args.
    expect(latest).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ extId: 'a', args: ['HEARTBEAT'] });

    await loaded.dispose();
  });

  it('isolates a thrown handler as a rejection; the proxy stays usable', async () => {
    const { broker, grants } = makeBroker();
    broker.registerApi('telemetry.boom', 'telemetry:read', () =>
      Promise.reject(new Error('handler exploded')),
    );
    broker.registerApi('telemetry.latest', 'telemetry:read', () => Promise.resolve('ok'));
    await grants.grant('a', ['telemetry:read']);

    let caught: unknown;
    let okResult: unknown;
    const evaluate: GuestEvaluate = () => ({
      activate: async (ctx: SandboxCtx): Promise<void> => {
        const telemetry = ctx.telemetry as TelemetryNode;
        try {
          await telemetry.boom();
        } catch (e) {
          caught = e;
        }
        okResult = await telemetry.latest();
      },
    });

    const runtime = createSandboxRuntime({ broker, spawn: createInProcessSpawner({ evaluate }) });
    const loaded = await runtime.load({ id: 'a', manifest, code: '' });
    await loaded.activate(NO_CTX);

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain('handler exploded');
    expect(okResult).toBe('ok');

    await loaded.dispose();
  });

  it('runs a provided ExtModule via the default (module) spawner', async () => {
    const { broker, grants } = makeBroker();
    broker.registerApi('telemetry.latest', 'telemetry:read', () => Promise.resolve(1));
    await grants.grant('a', ['telemetry:read']);

    let captured: ExtContext | undefined;
    const mod: ExtModule = {
      manifest,
      activate: (ctx: ExtContext): void => {
        captured = ctx;
      },
    };

    const runtime = createSandboxRuntime({ broker, spawn: createInProcessSpawner() });
    const record: ExtLoadRecord = { id: 'a', manifest, code: '', module: mod };
    const loaded = await runtime.load(record);
    await loaded.activate(NO_CTX);

    const c = captured as unknown as { telemetry: TelemetryNode };
    expect(typeof c.telemetry.latest).toBe('function');

    await loaded.dispose();
  });

  it('marks the load errored when the guest module activate throws', async () => {
    const { broker } = makeBroker();
    const evaluate: GuestEvaluate = () => ({
      activate: (): void => {
        throw new Error('activate boom');
      },
    });
    const runtime = createSandboxRuntime({ broker, spawn: createInProcessSpawner({ evaluate }) });
    const loaded = await runtime.load({ id: 'a', manifest, code: '' });
    await expect(loaded.activate(NO_CTX)).rejects.toThrow('activate boom');
    await loaded.dispose();
  });
});

describe('SandboxWatchdog', () => {
  it('fires the terminate hook once when a heartbeat is overdue', () => {
    const onTimeout = vi.fn<() => void>();
    let fire: (() => void) | undefined;
    const wd = new SandboxWatchdog({
      timeoutMs: 100,
      onTimeout,
      setTimer: (fn): unknown => {
        fire = fn;
        return 1;
      },
      clearTimer: (): void => {
        fire = undefined;
      },
    });

    wd.start();
    expect(onTimeout).not.toHaveBeenCalled();
    expect(fire).toBeDefined();

    fire?.();
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(wd.tripped).toBe(true);

    // A late timer callback cannot fire it again.
    fire?.();
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('re-arms on heartbeat and never fires after stop', () => {
    const onTimeout = vi.fn<() => void>();
    let fire: (() => void) | undefined;
    const wd = new SandboxWatchdog({
      timeoutMs: 100,
      onTimeout,
      setTimer: (fn): unknown => {
        fire = fn;
        return 1;
      },
      clearTimer: (): void => undefined,
    });

    wd.start();
    wd.beat(); // re-arm
    wd.stop();
    fire?.();
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('runtime terminates a runaway guest when the watchdog trips', async () => {
    const { broker } = makeBroker();
    let fire: (() => void) | undefined;
    const terminated: string[] = [];
    const runtime = createSandboxRuntime({
      broker,
      spawn: createInProcessSpawner({ evaluate: () => ({}) }),
      watchdog: {
        timeoutMs: 50,
        setTimer: (fn): unknown => {
          fire = fn;
          return 1;
        },
        clearTimer: (): void => undefined,
      },
      onTerminated: (id, reason): void => {
        terminated.push(`${id}:${reason}`);
      },
    });

    const loaded = await runtime.load({ id: 'a', manifest, code: '' });
    await loaded.activate(NO_CTX);
    expect(fire).toBeDefined();

    fire?.();
    expect(terminated).toEqual(['a:watchdog-timeout']);

    await loaded.dispose();
  });

  it('watchdog termination settles a hanging host.activate as errored', async () => {
    const { broker } = makeBroker();
    let fire: (() => void) | undefined;
    const runtime = createSandboxRuntime({
      broker,
      // The guest never answers GUEST_ACTIVATE (a spinning/hung activate).
      spawn: createInProcessSpawner({
        evaluate: () => ({ activate: (): Promise<void> => new Promise(() => undefined) }),
      }),
      watchdog: {
        timeoutMs: 50,
        setTimer: (fn): unknown => {
          fire = fn;
          return 1;
        },
        clearTimer: (): void => undefined,
      },
    });
    const host = new ExtensionHost({
      storage: fakeKv(),
      runtime,
      createContext: () => NO_CTX,
    });
    await host.install({ manifest, code: '' });

    const pending = host.activate('a');
    // The watchdog arms only after GUEST_INIT round-trips; wait for it.
    await vi.waitFor(() => {
      expect(fire).toBeDefined();
    });
    fire?.();

    // terminate() disposes the RPC, rejecting the in-flight GUEST_ACTIVATE,
    // so the host's activation settles (errored) instead of hanging forever.
    const state = await pending;
    expect(state.status).toBe('error');
    expect(state.error).toMatch(/disposed/i);
  });
});
