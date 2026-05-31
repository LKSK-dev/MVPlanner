/**
 * {@link AuditLog} — the in-memory action audit service (task T2.7; spec
 * plan/08 §8.3 destructive-action gating + audit, §8.8 exportable action log).
 *
 * Records every vehicle action (command / param-set / mission-write) as an
 * {@link AuditEntry}: `append` at start (status `pending`), then `update` when
 * the async result arrives. A bounded ring caps memory (oldest evicted); the
 * list, subscription and JSON/text export support an in-app viewer and incident
 * export (spec plan/08 §8.8). Persistence is intentionally out of scope here —
 * the log is pure and synchronous so it unit-tests with an injected clock; a
 * later task can wrap it with KV persistence (plan/08 §8.2 "audit log persists").
 *
 * Pure/testable: the clock and id factory are injected, there is no I/O, and
 * `list()` always returns a fresh frozen snapshot so callers cannot mutate
 * internal state.
 */
import {
  DEFAULT_MAX_ENTRIES,
  type AuditEntry,
  type AuditEntryInput,
  type AuditListener,
  type AuditLogOptions,
  type AuditPatch,
} from './types';

/** The audit-log service contract (see {@link RingAuditLog} for the impl). */
export interface AuditLog {
  /** Append a new entry (start of an action); returns the created entry. */
  append(entry: AuditEntryInput): AuditEntry;
  /** Patch an existing entry by id (e.g. record the result); returns it or `undefined`. */
  update(id: string, patch: AuditPatch): AuditEntry | undefined;
  /** Frozen snapshot of all retained entries, oldest first. */
  list(): readonly AuditEntry[];
  /** Subscribe to change notifications; returns an unsubscribe function. */
  subscribe(cb: AuditListener): () => void;
  /** Serialise the log as pretty JSON (for export/incident review). */
  exportJson(): string;
  /** Serialise the log as one human-readable line per entry. */
  exportText(): string;
  /** Drop all retained entries. */
  clear(): void;
}

/** Build an immutable {@link AuditEntry} from raw fields, omitting empty optionals. */
function freezeEntry(id: string, tMs: number, input: AuditEntryInput): AuditEntry {
  return Object.freeze({
    id,
    tMs,
    kind: input.kind,
    summary: input.summary,
    origin: input.origin ?? 'ui',
    status: input.status ?? 'pending',
    ...(input.params !== undefined ? { params: input.params } : {}),
    ...(input.result !== undefined ? { result: input.result } : {}),
    ...(input.tEndMs !== undefined ? { tEndMs: input.tEndMs } : {}),
  });
}

/** Apply a {@link AuditPatch} to an entry, returning a new frozen entry. */
function patchEntry(entry: AuditEntry, patch: AuditPatch): AuditEntry {
  return Object.freeze({
    ...entry,
    ...(patch.status !== undefined ? { status: patch.status } : {}),
    ...(patch.summary !== undefined ? { summary: patch.summary } : {}),
    ...(patch.result !== undefined ? { result: patch.result } : {}),
    ...(patch.tEndMs !== undefined ? { tEndMs: patch.tEndMs } : {}),
  });
}

/** Format one entry as a single export-text line. */
function entryLine(e: AuditEntry): string {
  const ts = new Date(e.tMs).toISOString();
  const head = `${ts}  ${e.status.toUpperCase().padEnd(9)} ${e.kind.padEnd(13)} ${e.origin}`;
  const detail = e.result !== undefined ? ` — ${e.summary} (${e.result})` : ` — ${e.summary}`;
  return head + detail;
}

/**
 * Bounded, in-memory {@link AuditLog}. Entries are kept oldest-first in a ring
 * capped at `maxEntries`; appending past the cap evicts the oldest. Every
 * mutation notifies subscribers with a fresh snapshot.
 */
export class RingAuditLog implements AuditLog {
  private readonly clock: () => number;
  private readonly maxEntries: number;
  private readonly idFactory: () => string;
  private entries: AuditEntry[] = [];
  private readonly listeners = new Set<AuditListener>();
  private counter = 0;

  constructor(options: AuditLogOptions = {}) {
    this.clock = options.clock ?? (() => Date.now());
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_MAX_ENTRIES);
    this.idFactory = options.idFactory ?? (() => `a${(++this.counter).toString(36)}`);
  }

  append(entry: AuditEntryInput): AuditEntry {
    const tMs = entry.tMs ?? this.clock();
    const created = freezeEntry(this.idFactory(), tMs, entry);
    this.entries.push(created);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
    this.emit();
    return created;
  }

  update(id: string, patch: AuditPatch): AuditEntry | undefined {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i < 0) return undefined;
    const current = this.entries[i];
    if (current === undefined) return undefined;
    const next = patchEntry(current, patch);
    this.entries[i] = next;
    this.emit();
    return next;
  }

  list(): readonly AuditEntry[] {
    return Object.freeze([...this.entries]);
  }

  subscribe(cb: AuditListener): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  exportJson(): string {
    return JSON.stringify(this.entries, null, 2);
  }

  exportText(): string {
    return this.entries.map(entryLine).join('\n');
  }

  clear(): void {
    if (this.entries.length === 0) return;
    this.entries = [];
    this.emit();
  }

  /** Notify subscribers with the current snapshot. */
  private emit(): void {
    if (this.listeners.size === 0) return;
    const snapshot = this.list();
    for (const l of this.listeners) l(snapshot);
  }
}

/** Construct a {@link RingAuditLog} (ergonomic factory mirroring sibling services). */
export function createAuditLog(options: AuditLogOptions = {}): RingAuditLog {
  return new RingAuditLog(options);
}
