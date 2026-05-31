# `ui/widgets/inspector` — MAVLink inspector (T1.12)

Spec: `plan/04` §4.9 (message/field tree + rates + hex), `plan/05` §5.4/§5.5.
A developer power-tool read view over live MAVLink traffic.

## What it shows

- A **(sysid, compid) selector** built from observed traffic.
- A searchable/filterable **message tree** — each message shows name, id,
  observed rate (Hz) and last-seen; expand it to see every field with its value
  and, where the dialect types the field as an enum, the decoded symbol.
- A raw/**HEX dump** of the selected message's latest frame.
- The latest frame's **signing / CRC status** (+ seq, count).

It is a pure read path: no DOM-blocking parse work — the worker builds the
table; the widget only renders it.

## Data contract (host extension, T1.12)

The widget consumes the host's ON-DEMAND inspector stream via the structural
`InspectorSource` seam:

```ts
interface InspectorSource {
  subscribeInspector(cb: (s: InspectorSnapshot) => void, opts?: { hz?: number }): () => void;
}
```

The real `MavlinkHost` (`src/mavlink/host`) satisfies this through its new
`subscribeInspector(cb, { hz? })` method, which opens the worker
`RPC_INSPECTOR = 'inspector'` stream. The worker builds the snapshot from the
`MessageRegistry` at ~6 Hz **only while subscribed** (see `mavlink/host/README.md`
→ "Inspector stream"). Each `InspectorRow` carries `{ sysid, compid, msgId,
name, rateHz, lastSeenMs, count, fields, raw, crcOk, signed, linkId?, seq,
rxTimeUs }`. Enum decoding is done here against the bundled `BUILTIN_DIALECTS`,
so the wire payload stays raw and light.

## Widget API

- `Inspector(props)` — Solid component. Props: `source` (required), `t`
  (required), `hz?`, `dialects?` (default `BUILTIN_DIALECTS`), `now?` (default
  `Date.now`). Subscribes on mount, unsubscribes on cleanup.
- `createInspectorPanel(source, t): PanelDef` — dockable panel (id
  `widget.inspector`) that mounts `Inspector` into a dock leaf.
- `toggleInspectorWindow(source, t)` — open/close the non-modal detachable
  pop-out window (spec §4.10 "inspector pop-out").
- `registerInspector(registry, source, t): () => void` — registers the panel +
  the `Open MAVLink Inspector` command (palette, id `inspector.open`); the
  returned disposer unregisters both and closes the pop-out.

Pure helpers (also unit-tested): `createEnumDecoder`, `toHex`, `formatHexDump`,
`formatFieldValue`, `formatRate`, `formatAge`.

## How it is registered / reached

`registerInspector(registry, host, t)` registers a dockable panel and a command;
the command is reachable from the ⌘K command palette and pops the inspector out
into a detachable window. Workspaces can also dock the panel by id
`widget.inspector`.

> **Integration note.** Per the task boundary this widget does NOT edit
> `src/App.tsx`. The single wiring line — `registerInspector(registry, host, t)`
> alongside the other shell registrations, with `import './ui/widgets/inspector/inspector.css'`
> — is the orchestrator's integration step (App owns the singleton host).

## How to test

- `test/unit/inspector-session.test.ts` — the host data path: feed
  `MavlinkSession` real encoded frames and assert `takeInspectorSnapshot()`
  rows (name / rate / last-seen / fields / raw hex / crc / signed).
- `test/unit/inspector-widget.test.ts` — the widget over a mock `InspectorSource`:
  renders the tree, filters on search, expands fields (with enum decode), shows
  the hex view, and switches `(sysid, compid)`.
