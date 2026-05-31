# `core/audit` — action audit log (T2.7)

Spec: `plan/08` §8.3 (destructive-action gating + audit-logging with origin),
§8.2 (data safety — "action audit log persists"), §8.8 (observability —
"action audit log (commands/params/mission) exportable for incident review").

A small, **pure** service that records every _vehicle action_ — `command`,
`param-set`, `mission-write` — with what was sent, **who** sent it (`'ui'` vs an
extension id), and how it resolved. It backs the Flight actions bar's
confirm→command→audit flow (T2.7), the extension sandbox's audited API surface
(T7.2), and an in-app viewer/export.

No I/O, no protocol types: an entry is a plain serialisable record. The clock
and id factory are injected, so it unit-tests deterministically.

## Entry shape

```ts
interface AuditEntry {
  id: string; // stable, log-unique (render key + update target)
  tMs: number; // wall-clock start (ms)
  kind: 'command' | 'param-set' | 'mission-write';
  summary: string; // already-localised one-liner
  origin: 'ui' | string; // 'ui' or an extension id
  status: 'pending' | 'ok' | 'error' | 'cancelled';
  params?: Record<string, number | string | boolean> | readonly (number | string | boolean)[];
  result?: string; // 'ok', an error message, or MAV_RESULT name
  tEndMs?: number; // completion time (ms)
}
```

## API

```ts
interface AuditLog {
  append(entry: AuditEntryInput): AuditEntry; // start; id generated, status defaults 'pending'
  update(id: string, patch: AuditPatch): AuditEntry | undefined; // record the async result
  list(): readonly AuditEntry[]; // frozen snapshot, oldest-first
  subscribe(cb: (entries: readonly AuditEntry[]) => void): () => void;
  exportJson(): string; // pretty JSON
  exportText(): string; // one human line per entry
  clear(): void;
}

const audit = createAuditLog({ clock, maxEntries: 1000, idFactory });
```

`append` returns the created entry; capture its `id` and `update(id, …)` it once
the command/param/mission op settles:

```ts
const e = audit.append({ kind: 'command', summary: 'Arm', origin: 'ui' });
try {
  await command.arm(true);
  audit.update(e.id, { status: 'ok', result: 'ok', tEndMs: Date.now() });
} catch (err) {
  audit.update(e.id, { status: 'error', result: String(err), tEndMs: Date.now() });
}
```

`subscribe` fires on every `append`/`update`/`clear` with a fresh frozen
snapshot (it does **not** replay the current state on subscribe — seed from
`list()` first). A bounded ring (`maxEntries`, default 1000) evicts the oldest.

## Persistence

Out of scope for T2.7: the log is in-memory and pure. A later task can wrap it
with the `data/storage` KV layer to satisfy "audit log persists" (§8.2) without
changing this surface.

## How to test

`test/unit/audit-log.test.ts` covers append (defaults + clock/id injection),
update (result recording + unknown id), the ring bound + eviction, subscribe
fan-out + unsubscribe, and JSON/text export.
