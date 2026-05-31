# `src/core/i18n` — message catalog & locale formatting

Runtime-switchable i18n for MVPlanner (T0.8; evolves the T0.1 shim). All
user-facing strings route through `t()` from day one — no hard-coded UI copy
(conventions `plan/implementation/00` §0.3; spec `plan/05` §5.9).

## Contract (public surface — import from `src/core/i18n`)

- `t(key, vars?)` — translate `key` in the active locale, substituting `{var}`
  placeholders. Resolution order: **active-locale catalog → English → the key**.
  Reads the active-locale signal, so Solid consumers re-render on a language
  switch. _Backward-compatible with the original shim signature._
- Locale registry / active locale (`./locale.ts`):
  - `DEFAULT_LOCALE` (`'en'`), `locale` (reactive `Accessor<LocaleCode>`)
  - `getLocale()`, `setLocale(code)` — signal-backed; unknown codes still apply
    and fall back per-key.
  - `registerLocale(code, messages)` — register/replace a runtime locale
    (community/extension catalogs; partial catalogs fall back to English).
  - `registerMessages(messages, locale = 'en')` — **additively** merge keys into
    a locale's in-memory catalog (see _Module-contributed strings_ below).
  - `hasLocale(code)`, `listLocales()`
- Intl formatters (`./format.ts`, active-locale aware): `formatNumber`,
  `formatInteger`, `formatDecimal`, `formatDate`, `formatTime`, `formatDateTime`.
- Types: `MessageCatalog`, `MessageVars`, `LocaleCode`, `DateInput`.

## Module-contributed strings (`registerMessages`)

To unblock parallel UI work, a module does **not** have to edit the central
`EN_MESSAGES` catalog to add its own copy. Instead, each UI module calls
`registerMessages({...})` at import time to contribute its namespaced keys (e.g.
`hud.*`, `gauges.*`):

```ts
import { registerMessages } from '@/core/i18n';

registerMessages({
  'hud.altitude': 'Altitude',
  'hud.airspeed': 'Airspeed',
});
```

Semantics:

- **Additive / non-destructive** — merges on top of the existing catalog; never
  replaces it and never mutates the shipped `EN_MESSAGES` object.
- **Last-write-wins** — a later registration overrides an earlier entry for the
  same key (a dev-mode `console.warn` flags such overrides).
- **Same `t()` precedence** — registered keys resolve via `t()` as **active
  locale → English → key**, and react to the active-locale signal.
- **Locale-targeted** — `locale` defaults to `'en'`; pass another code to seed a
  translation. Keys registered under a non-active locale take effect once
  `setLocale(code)` switches to it.

## Owned files

- `index.ts` — public barrel + `t()`.
- `catalog.ts` — catalog types + shipped English strings (`EN_MESSAGES`) +
  `interpolate`.
- `locale.ts` — locale registry + active-locale Solid signal.
- `format.ts` — thin `Intl` number/date wrappers.

## Out of scope (intentionally)

Coordinate formatting and metric/imperial unit conversion are **T3.8**
(`src/geo/format`, `src/core/units`) — only `Intl` number/date wrappers live
here. The formal locale/RTL/pseudo-loc pass is **T8.11**.

## How to test

```
npx vitest run test/unit/i18n.test.ts
```

Covers `t()` backward-compat + fallbacks, the locale registry/signal,
`registerMessages` (additive merge, override-last-wins, non-active locale), and
the Intl formatters.
