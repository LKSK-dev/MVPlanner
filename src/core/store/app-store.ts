/**
 * Reactive application store backed by `solid-js/store` (contract
 * `src/contracts/store.ts` {@link Store}; impl 02 §2.1, impl 03 T0.5;
 * spec plan/02 §2.1, plan/07 §7.2).
 *
 * The store owns the single source of truth for {@link AppState}. Writes go
 * through {@link Store.patch}, which coalesces rapid mutations into one
 * reactive update per microtask so downstream selectors notify their consumers
 * at most once per tick. Reads are either non-reactive ({@link Store.get}) or
 * fine-grained reactive ({@link Store.select}), the latter only firing when its
 * selected value actually changes.
 *
 * Settings and layout are optionally persisted to an injected {@link KvStore}
 * (debounced) and rehydrated on init. Persistence is triggered from the write
 * path (the coalesced flush) rather than a reactive effect so it behaves
 * identically whether or not the store lives inside a component owner. This
 * module depends only on the `KvStore` contract — the concrete IndexedDB
 * implementation lands in T0.9.
 */
import { batch, createMemo, createRoot, getOwner, runWithOwner } from 'solid-js';
import { createStore, produce, unwrap } from 'solid-js/store';
import type { Accessor, AppSettings, AppState, KvStore, LayoutState, Store } from '../../contracts';
import { mergeAppState } from './app-state';

/** KV namespace + keys under which settings/layout are persisted. */
const PERSIST_NS = 'app';
const KEY_SETTINGS = 'settings';
const KEY_LAYOUT = 'layout';

/** Debounce window for persistence writes (ms). */
const PERSIST_DEBOUNCE_MS = 150;

/**
 * Re-surface a persistence failure asynchronously instead of silently
 * swallowing it (conventions plan/implementation/00 §0.3). Persistence is
 * best-effort and must never break the reactive store, so the error is raised
 * in a fresh microtask for global error handling rather than thrown into the
 * caller's flow.
 */
function reportPersistError(err: unknown): void {
  queueMicrotask(() => {
    throw err instanceof Error ? err : new Error(`store persistence failed: ${String(err)}`);
  });
}

/** Deep, detached, JSON-safe copy — safe to hand to {@link KvStore.set}. */
function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Settings as persisted to disk, with the map-tile **API key redacted**. The
 * key is a local secret: it stays in the in-memory store (the map consumes it)
 * and is encrypted-at-rest by the WebCrypto secret store (see `src/App.tsx`),
 * but it must never be written to the KvStore in plaintext (audit P0.2).
 */
function persistableSettings(s: AppSettings): AppSettings {
  if (s.mapSource?.apiKey === undefined) return s;
  return { ...s, mapSource: { urlTemplate: s.mapSource.urlTemplate } };
}

/** Stable serialization of the persisted slice, for change detection. */
function persistKey(s: AppState): string {
  return JSON.stringify({ settings: persistableSettings(s.settings), layout: s.layout });
}

/**
 * Create a reactive {@link Store} of {@link AppState}.
 *
 * @param initial - Optional partial state merged over the documented defaults
 *   (see {@link mergeAppState}).
 * @param persist - Optional {@link KvStore}. When supplied, `settings` and
 *   `layout` are rehydrated on init and persisted (debounced) whenever a patch
 *   changes them. When omitted, the store is purely in-memory (persistence is a
 *   no-op).
 * @returns A {@link Store} whose reactive graph lives for the app's lifetime.
 */
export function createAppStore(initial?: Partial<AppState>, persist?: KvStore): Store<AppState> {
  const initialState = mergeAppState(initial);

  // Build the reactive graph inside a root so every selector memo created
  // lazily by select() has a stable, non-disposing owner (this is an
  // app-lifetime singleton); without it, memos created outside a component
  // scope would leak and warn.
  return createRoot(() => {
    const [state, setState] = createStore<AppState>(initialState);
    const owner = getOwner();

    // --- debounced persistence (driven from the write path) ---------------
    let persistTimer: ReturnType<typeof setTimeout> | undefined;
    let lastPersistKey = persistKey(initialState);

    const writePersistSnapshot = (snap: AppState): void => {
      if (!persist) return;
      const kv = persist;
      const settings = snapshot(persistableSettings(snap.settings));
      const layout = snapshot(snap.layout);
      const writtenKey = JSON.stringify({ settings, layout });
      void Promise.all([
        kv.set<AppSettings>(PERSIST_NS, KEY_SETTINGS, settings),
        kv.set<LayoutState>(PERSIST_NS, KEY_LAYOUT, layout),
      ])
        .then(() => {
          lastPersistKey = writtenKey;
        })
        .catch(reportPersistError);
    };

    const persistNowIfChanged = (): void => {
      if (!persist) return;
      const snap = unwrap(state);
      const key = persistKey(snap);
      if (key === lastPersistKey) return; // settings/layout unchanged
      writePersistSnapshot(snap);
    };

    const schedulePersistIfChanged = (): void => {
      if (!persist) return;
      const key = persistKey(unwrap(state));
      if (key === lastPersistKey) return; // settings/layout unchanged
      if (persistTimer !== undefined) clearTimeout(persistTimer);
      persistTimer = setTimeout(() => {
        persistTimer = undefined;
        persistNowIfChanged();
      }, PERSIST_DEBOUNCE_MS);
    };

    const flushPersistNow = (): void => {
      if (persistTimer !== undefined) {
        clearTimeout(persistTimer);
        persistTimer = undefined;
      }
      persistNowIfChanged();
    };

    // --- coalesced writes -------------------------------------------------
    const pending: Array<(draft: AppState) => void> = [];
    let flushScheduled = false;

    const flush = (): void => {
      flushScheduled = false;
      if (pending.length === 0) return;
      const updaters = pending.splice(0, pending.length);
      // One batched, produce-based mutation applies every queued updater, so
      // consumers see a single reactive update for the whole tick.
      batch(() => {
        setState(
          produce((draft: AppState) => {
            for (const updater of updaters) updater(draft);
          }),
        );
      });
      schedulePersistIfChanged();
    };

    const patch = (updater: (draft: AppState) => void): void => {
      pending.push(updater);
      if (!flushScheduled) {
        flushScheduled = true;
        queueMicrotask(flush);
      }
    };

    if (persist && typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      const flushOnPageExit = (): void => {
        flush();
        flushPersistNow();
      };
      window.addEventListener('pagehide', flushOnPageExit);
      window.addEventListener('visibilitychange', () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
          flushOnPageExit();
        }
      });
    }

    // --- reads ------------------------------------------------------------
    /** Non-reactive view of the current state; use {@link select} for reactivity. */
    const get = (): AppState => unwrap(state);

    const select = <R>(sel: (s: AppState) => R): Accessor<R> => {
      const accessor = runWithOwner(owner, () => createMemo(() => sel(state)));
      if (!accessor) throw new Error('createAppStore: reactive owner unavailable');
      return accessor;
    };

    // --- rehydrate on init ------------------------------------------------
    if (persist) {
      const kv = persist;
      void (async (): Promise<void> => {
        const [savedSettings, savedLayout] = await Promise.all([
          kv.get<Partial<AppSettings>>(PERSIST_NS, KEY_SETTINGS),
          kv.get<Partial<LayoutState>>(PERSIST_NS, KEY_LAYOUT),
        ]);
        if (!savedSettings && !savedLayout) return;
        patch((draft) => {
          if (savedSettings) draft.settings = { ...draft.settings, ...savedSettings };
          if (savedLayout) draft.layout = { ...draft.layout, ...savedLayout };
          // 'persisted wins': any early synchronous patch issued before this
          // rehydrate completes is overwritten here by the persisted values.
          // Advance the persist baseline to the rehydrated snapshot so reading
          // persisted state back does not trigger a redundant KV write-back on
          // launch (the seeded baseline was the pre-rehydrate initial state).
          lastPersistKey = persistKey(draft);
        });
      })().catch(reportPersistError);
    }

    return { get, select, patch };
  });
}
