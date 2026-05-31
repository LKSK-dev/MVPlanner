# `ui/widgets/messages` — STATUSTEXT console (T2.8)

Spec: `plan/04` §4.2 (status messages console), `plan/05` §5.4 (Flight screen),
§5.7/§5.8 (interaction + a11y live regions). A **severity-colored scrollback** of
vehicle `STATUSTEXT` messages with a severity filter, a clear action, per-row
timestamps, and ARIA live regions so screen readers announce new messages.

The console is a pure presentational Solid component taking a **reactive buffer
accessor** — it never touches the host/store/Worker, so it is unit-testable with
mock data. The wiring (subscribe + accumulate a bounded buffer) belongs to T2.11.

## View type & prop API

`StatusMessage` is a **widget-local view model** (NOT a contract change to
`src/contracts/mavlink.ts`):

```ts
interface StatusMessage {
  severity: number; // raw MAV_SEVERITY 0 EMERGENCY .. 7 DEBUG
  text: string; // NUL-trimmed STATUSTEXT text
  sysid: number;
  compid: number;
  tMs: number; // wall-clock receive time (ordering + timestamp)
  seq?: number; // stable render key / tiebreaker
}

const MessagesConsole: Component<{
  messages: () => readonly StatusMessage[]; // REACTIVE bounded buffer
  t: TFn;
  onClear?: () => void; // caller may empty its buffer
  now?: () => number; // clock (default Date.now)
  maxRender?: number; // cap rendered rows (default 500)
}>;
```

### How T2.11 feeds it

T2.11 owns the bounded buffer and the subscription, e.g.:

```ts
const [buf, setBuf] = createSignal<StatusMessage[]>([]);
let seq = 0;
const off = host.onMessage(['STATUSTEXT'], (m) =>
  setBuf((prev) => [...prev, statusMessageFromDecoded(m, Date.now(), seq++)].slice(-1000)),
);
// <MessagesConsole messages={buf} t={t} onClear={() => setBuf([])} />
import './ui/widgets/messages/messages.css';
```

`statusMessageFromDecoded(msg, tMs?, seq?)` and `parseStatusText(field)` are
exported so the parsing is shared and tested once. `parseStatusText` accepts an
already-decoded `string` **or** a raw `char[]` as `number[]` (stops at the first
NUL).

## Severity tiers & a11y (§5.8)

`severityTier(severity)` collapses the eight MAV_SEVERITY levels onto the shared
error/warn/info color system (`--mvp-error` / `--mvp-warn` / `--mvp-ok`):

| severity | name(s)                  | tier  | live region             |
| -------- | ------------------------ | ----- | ----------------------- |
| 0–3      | EMERGENCY/ALERT/CRIT/ERR | error | 0–2 assertive, 3 polite |
| 4–5      | WARNING/NOTICE           | warn  | polite                  |
| 6–7      | INFO/DEBUG               | info  | polite                  |

Color is **never the only cue**: every row also shows a tier **glyph**
(`aria-hidden`) and the **full level name** (e.g. `CRITICAL`), plus a
`data-tier`/`data-severity` attribute. The scrollback is `role="log"`
`aria-live="polite"`; a separate visually-hidden `role="alert"`
`aria-live="assertive"` region mirrors the latest EMERGENCY/ALERT/CRITICAL text
(`isAssertiveSeverity`, severity ≤ 2) so it interrupts.

Rows render **newest-first** so the latest are visible without scrolling. The
filter (`All` / `Warnings & errors` / `Errors only`) and clear both run locally;
**clear** records a cutoff instant (hiding everything received up to it) AND
calls `onClear`, so it works even when the caller's buffer is read-only.

## i18n

`register.ts` contributes the `statustext.*` English namespace via the public
`registerMessages` seam (imported for side effect by `index.ts`) — no central
catalog edit.

## How to test

- `test/unit/messages-severity.test.ts` — pure tier/assertive/name/rank mapping
  and STATUSTEXT text/frame parsing.
- `test/unit/messages-widget.test.ts` — the component over a reactive accessor:
  tier classes/labels/glyph, newest-first order, polite log + assertive alert
  live regions, the severity filter, and clear (+ `onClear`).

> **Integration note.** Per the task boundary this widget does NOT edit the
> Flight screen or `src/App.tsx`. Mounting `MessagesConsole` with a
> store/host-backed buffer accessor and importing `messages.css` belongs to
> T2.11 / the orchestrator's integration.
