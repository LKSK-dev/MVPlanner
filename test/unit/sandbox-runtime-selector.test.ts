/**
 * Per-extension runtime selector (task T8.12; spec plan/06 §6.6, plan/08 §8.3).
 *
 * An imported/untrusted extension is routed through the SANDBOX runtime (the
 * injected {@link createInProcessSpawner} guest spawner is invoked), while a
 * bundled first-party example installed with `trusted: true` runs in the TRUSTED
 * in-process runtime (the spawner is never invoked). Without a spawner the
 * selector falls back to in-process for everything (the real-Worker browser
 * spawn is the deferred path).
 */
import { describe, expect, it } from 'vitest';
import type {
  CommandClient,
  ConnState,
  DecodedMessage,
  FileIo,
  KvStore,
  MissionClient,
  ParamClient,
} from '../../src/contracts';
import { createAppStore } from '../../src/core/store';
import { createUiRegistry } from '../../src/ui/shell';
import { createEventsBus, createExtensionSystem, type ExtApiServices } from '../../src/ext/api';
import type { ExtLoadRecord, ExtModule } from '../../src/ext/host';
import { createInProcessSpawner, type SpawnedGuest } from '../../src/ext/sandbox';
import { createExtServices, type ExtHost } from '../../src/ui/screens/sim';

function memKv(): KvStore {
  const m = new Map<string, unknown>();
  const key = (ns: string, k: string): string => `${ns}::${k}`;
  return {
    get: <T>(ns: string, k: string): Promise<T | undefined> =>
      Promise.resolve(m.get(key(ns, k)) as T | undefined),
    set: <T>(ns: string, k: string, v: T): Promise<void> => {
      m.set(key(ns, k), v);
      return Promise.resolve();
    },
    del: (ns: string, k: string): Promise<void> => {
      m.delete(key(ns, k));
      return Promise.resolve();
    },
  };
}

function fakeHost(): ExtHost {
  const noop = (): void => undefined;
  return {
    sendMessage: () => undefined,
    onMessage: (_n: readonly string[], _cb: (m: DecodedMessage) => void) => noop,
    onState: (_cb: (s: ConnState) => void) => noop,
    onTelemetry: (_cb: (s: unknown) => void) => noop,
    subscribeInspector: () => noop,
  };
}

const okCommand = (): CommandClient => {
  const ok = (): Promise<void> => Promise.resolve();
  return {
    send: () => Promise.resolve({ result: 0 }),
    arm: ok,
    setMode: ok,
    takeoff: ok,
    land: ok,
    rtl: ok,
    guidedGoto: ok,
    setRoi: ok,
    clearRoi: ok,
    setCurrentWp: ok,
  };
};
const okParams = (): ParamClient => ({
  fetchAll: () => Promise.resolve([]),
  get: () => undefined,
  set: () => Promise.resolve(),
  onChange: () => () => undefined,
});
const okMission = (): MissionClient => ({
  download: () => Promise.resolve({ type: 'mission', items: [] }),
  upload: () => Promise.resolve(),
  clear: () => Promise.resolve(),
  setCurrent: () => Promise.resolve(),
  onCurrent: () => () => undefined,
  onReached: () => () => undefined,
});
const fakeFiles = (): FileIo => ({
  openForRead: () => Promise.resolve(undefined),
  saveAs: () => Promise.resolve(),
});

/** A no-op module (its `activate` ignores ctx, so either runtime can load it). */
function noopModule(id: string): ExtModule {
  return {
    manifest: { id, name: id, version: '1.0.0', apiVersion: '^1.0', permissions: [] },
    activate: () => undefined,
  };
}

describe('extension runtime selector (T8.12)', () => {
  it('routes untrusted through the sandbox and trusted in-process', async () => {
    const spawnedIds: string[] = [];
    const base = createInProcessSpawner();
    const spawn = (record: ExtLoadRecord): Promise<SpawnedGuest> => {
      spawnedIds.push(record.id);
      return base(record);
    };

    const ext = createExtServices({
      host: fakeHost(),
      store: createAppStore(),
      command: okCommand(),
      params: okParams(),
      mission: okMission(),
      registry: createUiRegistry(),
      files: fakeFiles(),
    });
    const system = createExtensionSystem({
      storage: memKv(),
      services: ext.services as ExtApiServices,
      confirm: () => Promise.resolve(true),
      events: createEventsBus(),
      spawn,
    });

    await system.install({ module: noopModule('trusted.ext'), trusted: true });
    await system.install({ module: noopModule('untrusted.ext') }); // default trusted=false

    await system.activate('trusted.ext');
    await system.activate('untrusted.ext');

    expect(spawnedIds).toContain('untrusted.ext'); // sandboxed
    expect(spawnedIds).not.toContain('trusted.ext'); // in-process

    expect(system.host.get('trusted.ext')?.status).toBe('active');
    expect(system.host.get('untrusted.ext')?.status).toBe('active');

    ext.dispose();
    system.dispose();
  });

  it('falls back to in-process for everything without a spawner', async () => {
    const ext = createExtServices({
      host: fakeHost(),
      store: createAppStore(),
      command: okCommand(),
      params: okParams(),
      mission: okMission(),
      registry: createUiRegistry(),
      files: fakeFiles(),
    });
    const system = createExtensionSystem({
      storage: memKv(),
      services: ext.services as ExtApiServices,
      confirm: () => Promise.resolve(true),
      events: createEventsBus(),
    });

    await system.install({ module: noopModule('imported.ext') }); // untrusted, no spawn
    await system.activate('imported.ext');
    expect(system.host.get('imported.ext')?.status).toBe('active');

    ext.dispose();
    system.dispose();
  });
});
