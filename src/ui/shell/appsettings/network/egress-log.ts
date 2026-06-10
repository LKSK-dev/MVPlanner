/**
 * Egress log (task T8.12; spec plan/07 §7.7, plan/08 §8.3 egress transparency).
 *
 * A small, bounded, DOM-free ring that records every network egress the app
 * actually performs. It is the sink the {@link import('../../../../ext/permissions').PermissionBroker}
 * `recordEgress` writes to (extension `net:<host>` calls), and it backs the
 * live list in App Settings → General → Network. The store keeps a privacy-preserving record
 * — host + URL + which extension — and never phones anything home.
 *
 * Subscribe/snapshot is a plain listener pattern (no Solid dependency) so it can
 * be created at the app root and consumed by the reactive Network section.
 */
import type { EgressRecord } from '../../../../ext/permissions';

/** One recorded egress event. */
export interface EgressEntry {
  /** Monotonic id (insertion order). */
  readonly id: number;
  /** Timestamp (ms since epoch). */
  readonly at: number;
  /** The extension that made the call. */
  readonly extId: string;
  /** The destination host (`host:port`). */
  readonly host: string;
  /** The full request URL. */
  readonly url: string;
}

/** The egress log surface. */
export interface EgressLog {
  /** Record an egress event (the broker `recordEgress` sink). */
  record(info: EgressRecord): void;
  /** A newest-first snapshot of recorded entries. */
  list(): readonly EgressEntry[];
  /** Clear the log. */
  clear(): void;
  /** Subscribe to changes; returns an unsubscribe handle. */
  subscribe(cb: () => void): () => void;
}

/** Options for {@link createEgressLog}. */
export interface EgressLogOptions {
  /** Max retained entries (oldest dropped past this). Default 200. */
  max?: number;
  /** Clock (deterministic tests). Default {@link Date.now}. */
  now?: () => number;
}

/** Default retained-entry cap. */
export const DEFAULT_EGRESS_MAX = 200;

/** Build an in-memory {@link EgressLog}. */
export function createEgressLog(opts: EgressLogOptions = {}): EgressLog {
  const max = opts.max ?? DEFAULT_EGRESS_MAX;
  const now = opts.now ?? Date.now;
  const entries: EgressEntry[] = [];
  const listeners = new Set<() => void>();
  let nextId = 1;

  const emit = (): void => {
    for (const cb of listeners) cb();
  };

  return {
    record(info: EgressRecord): void {
      entries.push({ id: nextId++, at: now(), extId: info.extId, host: info.host, url: info.url });
      if (entries.length > max) entries.splice(0, entries.length - max);
      emit();
    },
    list(): readonly EgressEntry[] {
      return [...entries].reverse();
    },
    clear(): void {
      if (entries.length === 0) return;
      entries.length = 0;
      emit();
    },
    subscribe(cb: () => void): () => void {
      listeners.add(cb);
      return (): void => {
        listeners.delete(cb);
      };
    },
  };
}
