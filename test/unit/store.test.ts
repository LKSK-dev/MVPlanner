import { describe, it, expect, vi } from 'vitest';
import { createEffect, createMemo, createRoot, createSignal } from 'solid-js';
import type { AppSettings, AppState, KvStore, LayoutState } from '../../src/contracts';
import { createAppStore } from '../../src/core/store';

// ---------------------------------------------------------------------------
// Harness capability probe
// ---------------------------------------------------------------------------
// Solid ships separate runtime builds. The unit harness resolves the REACTIVE
// build: vitest.config.ts runs vite-plugin-solid with
// resolve.conditions ['development', 'browser'], so createEffect/createMemo
// actually fire here. We still probe reactivity at runtime and assert it below
// (a non-gated guard test) so a future vitest-config regression that silently
// reverts to Solid's SSR no-op build fails loudly instead of skipping the
// reactive fan-out tests.
const REACTIVE: boolean = createRoot((dispose) => {
  const [n, setN] = createSignal(1);
  const m = createMemo(() => n());
  setN(2);
  const ok = m() === 2;
  dispose();
  return ok;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Macrotask turn: flushes the patch microtask + synchronous reactive updates. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** In-memory {@link KvStore} (no IndexedDB) with a peek into stored values. */
function makeFakeKv(): KvStore & { peek<T>(ns: string, key: string): T | undefined } {
  const data = new Map<string, unknown>();
  const k = (ns: string, key: string): string => `${ns}::${key}`;
  return {
    get<T>(ns: string, key: string): Promise<T | undefined> {
      return Promise.resolve(data.get(k(ns, key)) as T | undefined);
    },
    set<T>(ns: string, key: string, v: T): Promise<void> {
      data.set(k(ns, key), v);
      return Promise.resolve();
    },
    del(ns: string, key: string): Promise<void> {
      data.delete(k(ns, key));
      return Promise.resolve();
    },
    peek<T>(ns: string, key: string): T | undefined {
      return data.get(k(ns, key)) as T | undefined;
    },
  };
}

const DEFAULT_STATE: AppState = {
  connection: { kind: 'closed' },
  vehicles: {},
  settings: {
    units: 'metric',
    coordinateFormat: 'dd',
    theme: 'dark',
    language: 'en',
    audioAlerts: true,
    confirmDestructive: true,
  },
  layout: { activeScreen: 'flight', workspaces: {} },
};

// ---------------------------------------------------------------------------
// Default state shape + merge
// ---------------------------------------------------------------------------

describe('harness reactivity guard', () => {
  it('resolves Solid\u2019s reactive build (not the SSR no-op build)', () => {
    // Non-gated: if the vitest config regresses to the SSR build this fails
    // loudly rather than silently skipping the reactive fan-out tests below.
    expect(REACTIVE).toBe(true);
  });
});

describe('createAppStore — defaults & merge', () => {
  it('exposes the documented default app state', () => {
    const store = createAppStore();
    expect(store.get()).toEqual(DEFAULT_STATE);
  });

  it('merges a partial initial state over the defaults', () => {
    const store = createAppStore({
      connection: { kind: 'open' },
      activeSysid: 7,
      settings: {
        units: 'imperial',
        coordinateFormat: 'mgrs',
        theme: 'light',
        language: 'fr',
        audioAlerts: false,
        confirmDestructive: false,
      },
    });
    expect(store.get().connection).toEqual({ kind: 'open' });
    expect(store.get().activeSysid).toBe(7);
    expect(store.get().settings.theme).toBe('light');
    // unspecified branches keep their defaults
    expect(store.get().layout).toEqual({ activeScreen: 'flight', workspaces: {} });
  });

  it('select() returns an accessor reflecting current state at creation', () => {
    const store = createAppStore({
      settings: { ...DEFAULT_STATE.settings, theme: 'field' },
    });
    const theme = store.select((s) => s.settings.theme);
    expect(typeof theme).toBe('function');
    expect(theme()).toBe('field');
  });
});

// ---------------------------------------------------------------------------
// patch: coalescing + state mutation (harness-agnostic, observed via get())
// ---------------------------------------------------------------------------

describe('createAppStore — patch & coalescing', () => {
  it('defers and coalesces rapid patches into a single flush', async () => {
    const store = createAppStore();

    store.patch((d) => {
      d.settings.units = 'imperial';
    });
    store.patch((d) => {
      d.layout.activeScreen = 'plan';
    });
    store.patch((d) => {
      d.settings.theme = 'light';
    });

    // Patches are coalesced: nothing is applied synchronously.
    expect(store.get().settings.units).toBe('metric');
    expect(store.get().layout.activeScreen).toBe('flight');

    await settle();

    // All queued mutations land together after the microtask flush.
    expect(store.get().settings.units).toBe('imperial');
    expect(store.get().settings.theme).toBe('light');
    expect(store.get().layout.activeScreen).toBe('plan');
  });

  it('patch mutates state observable via get()', async () => {
    const store = createAppStore();
    store.patch((d) => {
      d.vehicles[1] = {
        sysid: 1,
        compid: 1,
        mavType: 2,
        autopilot: 3,
        vehicleClass: 'copter',
        armed: false,
        mode: 'STABILIZE',
        attitude: { rollRad: 0, pitchRad: 0, yawRad: 0 },
        link: { bytesIn: 0, bytesOut: 0, packetsIn: 0, lossPct: 0, rateHz: 0, signed: false },
        lastHeartbeatMs: 0,
      };
    });
    await settle();
    expect(store.get().vehicles[1]?.mode).toBe('STABILIZE');
  });
});

// ---------------------------------------------------------------------------
// Reactive fan-out (requires a reactive Solid build — see harness probe above)
// ---------------------------------------------------------------------------

describe('createAppStore — reactivity', () => {
  it.runIf(REACTIVE)('patch notifies a select() accessor', async () => {
    const store = createAppStore();
    await createRoot(async (dispose) => {
      const theme = store.select((s) => s.settings.theme);
      let runs = 0;
      let last = '';
      createEffect(() => {
        last = theme();
        runs += 1;
      });
      await settle();
      expect(runs).toBe(1);
      expect(last).toBe('dark');

      store.patch((d) => {
        d.settings.theme = 'field';
      });
      await settle();

      expect(last).toBe('field');
      expect(runs).toBe(2);
      dispose();
    });
  });

  it.runIf(REACTIVE)('select only fires for relevant changes', async () => {
    const store = createAppStore();
    await createRoot(async (dispose) => {
      const theme = store.select((s) => s.settings.theme);
      let runs = 0;
      createEffect(() => {
        theme();
        runs += 1;
      });
      await settle();
      expect(runs).toBe(1);

      // unrelated fields changing must NOT re-run the theme selector
      store.patch((d) => {
        d.settings.units = 'imperial';
      });
      store.patch((d) => {
        d.layout.activeScreen = 'logs';
      });
      await settle();
      expect(runs).toBe(1);

      // a relevant change re-runs it exactly once (coalesced)
      store.patch((d) => {
        d.settings.theme = 'light';
      });
      store.patch((d) => {
        d.settings.theme = 'high-contrast';
      });
      await settle();
      expect(runs).toBe(2);
      dispose();
    });
  });
});

// ---------------------------------------------------------------------------
// Persistence (injected KvStore — no IndexedDB)
// ---------------------------------------------------------------------------

describe('createAppStore — persistence', () => {
  it('is a no-op when no KvStore is supplied', async () => {
    const store = createAppStore();
    expect(() =>
      store.patch((d) => {
        d.settings.theme = 'light';
      }),
    ).not.toThrow();
    await settle();
    expect(store.get().settings.theme).toBe('light');
  });

  it('persists settings + layout via the injected KvStore on change', async () => {
    const kv = makeFakeKv();
    const store = createAppStore(undefined, kv);

    store.patch((d) => {
      d.settings.theme = 'light';
      d.layout.activeScreen = 'plan';
    });

    await vi.waitFor(() => {
      const savedSettings = kv.peek<AppSettings>('app', 'settings');
      const savedLayout = kv.peek<LayoutState>('app', 'layout');
      expect(savedSettings?.theme).toBe('light');
      expect(savedLayout?.activeScreen).toBe('plan');
    });
  });

  it('does not persist when settings/layout are untouched', async () => {
    const kv = makeFakeKv();
    const store = createAppStore(undefined, kv);
    store.patch((d) => {
      d.connection = { kind: 'open' };
    });
    await settle();
    await settle();
    expect(kv.peek('app', 'settings')).toBeUndefined();
    expect(kv.peek('app', 'layout')).toBeUndefined();
  });

  it('rehydrates settings + layout from the KvStore on init', async () => {
    const kv = makeFakeKv();
    await kv.set<AppSettings>('app', 'settings', {
      units: 'imperial',
      coordinateFormat: 'utm',
      theme: 'high-contrast',
      language: 'de',
      audioAlerts: false,
      confirmDestructive: true,
    });
    await kv.set<LayoutState>('app', 'layout', { activeScreen: 'logs', workspaces: { a: 1 } });

    const store = createAppStore(undefined, kv);

    await vi.waitFor(() => {
      expect(store.get().settings.theme).toBe('high-contrast');
      expect(store.get().settings.units).toBe('imperial');
      expect(store.get().layout.activeScreen).toBe('logs');
      expect(store.get().layout.workspaces).toEqual({ a: 1 });
    });
  });
});
