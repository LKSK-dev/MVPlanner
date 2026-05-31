# `ui/widgets/quickwatch` — Quick-watch chips + mini-plot (T2.9)

Spec: `plan/04` §4.2 ("**Quick** tab equivalent: user picks any live field(s) to
watch" + "live tuning/quick-graph of arbitrary numeric fields (mini-plot)"),
`plan/05` §5.4/§5.5. The Flight screen's quick-watch chips.

## What it shows

- A **picker**: a search box + a browsable list of the live NUMERIC
  `message.field` paths the source currently exposes (e.g. `VFR_HUD.airspeed`,
  `SYS_STATUS.voltage_battery`). Already-watched fields drop out of the list.
- A **chip** per watched field: the `message.field` path, its **live value**
  (also exposed as the chip's text `aria-label`), a tiny **sparkline**
  (inline-SVG `<polyline>` of recent samples), and a remove button.

Adding/removing watches and value/sparkline updates all happen live.

## Data contract (the source seam, wired by T2.11)

The widget never touches the host/store directly — it consumes a structural
`QuickWatchSource`:

```ts
interface QuickWatchField {
  msg: string;
  field: string;
}

interface QuickWatchSource {
  /** Snapshot of the NUMERIC message.field paths to browse in the picker. */
  listFields(): readonly QuickWatchField[];
  /** Current numeric value for a path, or undefined if absent/non-numeric. */
  sample(msg: string, field: string): number | undefined;
  /** Fires when data may have changed; returns an unsubscribe fn. */
  subscribe(cb: () => void): () => void;
}
```

The widget `subscribe`s on mount (unsubscribes on cleanup); on each notification
it re-reads `sample()` for every watch and pushes one value into that watch's
bounded sample ring, then recomputes the sparkline. `listFields()` is re-read
reactively so the picker stays live.

**T2.11 wiring (host inspector / `onMessage`).** The Flight-screen assembly
builds a `QuickWatchSource` over the MAVLink host: it keeps the latest inspector
snapshot (or an `onMessage` tap), exposes the numeric fields of the active
`(sysid, compid)` rows via `listFields()` (a field is "numeric" when its
`InspectorRow.fields[field]` is a finite `number`/`bigint`), reads the latest
value in `sample()`, and forwards the host's update event to `subscribe`'s `cb`.
The watch list is persisted in the store: pass the persisted array as `watches`
and persist again from `onChange`.

## Widget API

`QuickWatch(props)` — Solid component. Props:

- `source` (required) — the `QuickWatchSource` above.
- `t` (required) — i18n translate fn.
- `watches?` — initial watch list (uncontrolled; seeded from the store by T2.11).
- `onChange?(watches)` — called with the next list on every add/remove (persist
  hook).
- `capacity?` — recent-sample ring size per watch (default `60`).
- `sparkline?: { width?; height? }` — sparkline px size (default `64×20`).

Registration glue (mirrors the other widgets):

- `createQuickWatchPanel(source, t, opts?): PanelDef` — dockable panel (id
  `widget.quickwatch`).
- `registerQuickWatch(registry, source, t, opts?): () => void` — registers the
  panel; the returned disposer unregisters it. `opts` carries `watches` /
  `onChange` / `capacity`.

Pure helpers (also unit-tested and exported): `RingBuffer` (bounded FIFO sample
ring), `sparklinePoints` / `sparklinePath` (polyline geometry),
`formatWatchValue`, and `pathOf` / `parsePath` / `samePath`.

## Sparkline approach

`sparklinePoints(samples, { width, height, padding? })` maps a series to evenly
spaced x (oldest `x=0` → newest `x=width`) and value-scaled y (max → top, min →
bottom; SVG y grows down). Empty → `[]`; single sample → centred; flat series →
mid-height line. `sparklinePath` joins the points into an SVG `points` string the
component renders as a `<polyline>`. All of it is pure and side-effect-free, so
the path math is tested without a DOM.

## Accessibility / i18n

- Each chip is labelled `"{path}: {value}"`; the decorative SVG is
  `aria-hidden`. The picker, search and remove controls carry `aria-label`s.
- All strings route through `t()` under the `quickwatch.*` namespace, registered
  at import via `registerMessages` (`./messages`) — never editing the central
  catalog.

## Integration note

Per the task boundary this widget does NOT edit `src/App.tsx` or the Flight
screen. The single wiring line — `registerQuickWatch(registry, source, t, {
watches, onChange })` alongside the other shell registrations, plus
`import './ui/widgets/quickwatch/quickwatch.css'` — is T2.11's integration step.

## How to test

- `test/unit/quickwatch-sparkline.test.ts` — pure logic: the ring buffer
  (bounded eviction, copy semantics), the sparkline geometry/path, the value
  formatter and the path helpers.
- `test/unit/quickwatch-widget.test.ts` — the widget over a mock
  `QuickWatchSource`: empty state + field list, add a watch (chip + value),
  live value/sparkline updates on new data, remove a watch, picker search, and
  source unsubscribe on cleanup.
