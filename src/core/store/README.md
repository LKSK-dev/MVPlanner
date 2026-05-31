# `src/core/store` — Reactive app store + persistence (T0.5)

Implements the frozen `Store<AppState>` seam (`src/contracts/store.ts`) on top of
`solid-js/store`. This is the single source of truth for application state
(connection, vehicles, settings, layout) and the only sanctioned write path.

- **Spec:** impl `02` §2.1; impl `03` T0.5; spec `plan/02` §2.1, `plan/07` §7.2.
- **Contract:** `Store<T>` (`get`/`select`/`patch`), `AppState`, `AppSettings`,
  `LayoutState`, `ScreenId`, `Accessor` — all from `@/contracts` (frozen, T0.3).

## Owned files

| File           | Concern                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `app-state.ts` | Pure defaults + `mergeAppState` (no reactive runtime, no I/O).              |
| `app-store.ts` | `createAppStore` — reactive store, coalesced writes, persistence.           |
| `index.ts`     | Public barrel (`createAppStore`, `createDefaultAppState`, `mergeAppState`). |

## Public API

```ts
import { createAppStore } from '@/core/store';

const store = createAppStore(initial?, persist?); // Store<AppState>

store.get();                       // non-reactive snapshot of current state
const theme = store.select((s) => s.settings.theme); // memoized Accessor<R>
store.patch((draft) => { draft.settings.theme = 'light'; });
```

- **`get()`** — non-reactive view of current state (Solid `unwrap`). For
  reactive reads use `select`.
- **`select(sel)`** — returns a memoized `Accessor` that recomputes via
  `createMemo` and only notifies consumers when the selected value actually
  changes (referential equality).
- **`patch(updater)`** — queues a `produce`-style mutation. Rapid patches in the
  same tick are **coalesced** into a single `batch`ed `setState` on the next
  microtask, so selectors fan out at most once per tick. Mutations are not
  applied synchronously.

### Defaults

`createDefaultAppState()` →
`connection {kind:'closed'}`, `vehicles {}`, settings `{ units:'metric',
coordinateFormat:'dd', theme:'dark', language:'en', audioAlerts:true,
confirmDestructive:true }`, layout `{ activeScreen:'flight', workspaces:{} }`.
`mergeAppState(initial?)` shallow-overrides top-level keys and one-level-merges
`settings`/`layout`/`vehicles`.

### Persistence

`createAppStore(initial, persist)` takes any `KvStore` (`src/contracts/storage.ts`).

- **Rehydrate on init:** reads `app/settings` and `app/layout`, merged over the
  defaults via a `patch`.
- **Persist on change (debounced ~150 ms):** triggered from the coalesced write
  flush whenever a patch changes `settings` or `layout`; unchanged slices are
  not rewritten. Driving persistence from the write path (rather than a reactive
  `createEffect`) keeps behaviour identical whether or not the store lives inside
  a component owner.
- Without a `KvStore`, persistence is a no-op (pure in-memory store).
- This module depends **only** on the `KvStore` contract; the IndexedDB
  implementation is T0.9.

## How to test

```
npx vitest run test/unit/store.test.ts
```

Covers: default state shape, partial-init merge, coalesced/deferred `patch`
observed via `get()`, `select` value correctness, persistence write + rehydrate
through an injected in-memory `KvStore` (no IndexedDB).

> **Harness note.** The reactive **fan-out** assertions (`select` notifying an
> effect; firing only for relevant changes) require a reactive Solid build. The
> unit harness now provides one: `vitest.config.ts` runs `vite-plugin-solid`
> with `resolve.conditions: ['development', 'browser']`, so `solid-js` resolves
> its **reactive** build (not the SSR no-op build) and `createEffect`/
> `createMemo` work. The reactive tests therefore **run** (they are no longer
> skipped). A non-gated `REACTIVE` probe asserts the harness is reactive so a
> future config regression fails loudly instead of silently skipping them.
