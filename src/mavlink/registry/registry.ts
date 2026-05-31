/**
 * {@link MessageRegistry} — ingests {@link DecodedMessage}s and answers
 * UI/inspector queries (task T1.4; spec plan/03 §3.3).
 *
 * Keyed by `(sysid, compid, msgId)`, it tracks the latest message, an observed
 * sliding-window rate, last-seen time, total count, and a bounded ring buffer
 * of recent frames. Per-`(sysid, compid)` it also keeps sequence-gap /
 * packet-loss stats (the codec defers loss accounting here, spec §3.2).
 *
 * This module provides the data + query surface only. UI coalescing/throttling
 * is the worker host's job (task T1.9), not the registry's.
 */
import type { DecodedMessage } from '../../contracts';
import { LinkLossTracker } from './loss';
import { SlidingWindowRate } from './rate';
import { RingBuffer } from './ring';
import type {
  IdNameResolver,
  LinkStats,
  MessageRecord,
  MessageRegistryOptions,
  SystemKey,
} from './types';

const DEFAULT_RING_CAPACITY = 20;
const DEFAULT_RATE_WINDOW_MS = 2000;
const DEFAULT_RATE_MAX_SAMPLES = 64;

/** Internal mutable per-stream state. */
interface MessageStat {
  sysid: number;
  compid: number;
  msgId: number;
  name: string;
  latest: DecodedMessage;
  lastSeenMs: number;
  count: number;
  rateHz: number;
  readonly ring: RingBuffer<DecodedMessage>;
  readonly rate: SlidingWindowRate;
}

function msgKey(sysid: number, compid: number, msgId: number): string {
  return `${sysid}:${compid}:${msgId}`;
}

function linkKey(sysid: number, compid: number): string {
  return `${sysid}:${compid}`;
}

function toRecord(stat: MessageStat): MessageRecord {
  return {
    sysid: stat.sysid,
    compid: stat.compid,
    msgId: stat.msgId,
    name: stat.name,
    latest: stat.latest,
    rateHz: stat.rateHz,
    lastSeenMs: stat.lastSeenMs,
    count: stat.count,
    ring: stat.ring.toArray(),
  };
}

function bySystemThenMsg(
  a: { sysid: number; compid: number; msgId?: number },
  b: { sysid: number; compid: number; msgId?: number },
): number {
  return a.sysid - b.sysid || a.compid - b.compid || (a.msgId ?? 0) - (b.msgId ?? 0);
}

/** Ingests decoded MAVLink and answers inspector/UI queries (spec §3.3). */
export class MessageRegistry {
  private readonly stats = new Map<string, MessageStat>();
  private readonly links = new Map<string, LinkLossTracker>();
  private readonly observedNameToId = new Map<string, number>();
  private readonly observedIdToName = new Map<number, string>();
  private readonly resolver: IdNameResolver | undefined;
  private readonly ringCapacity: number;
  private readonly rateWindowMs: number;
  private readonly rateMaxSamples: number;
  private readonly clock: () => number;

  constructor(options: MessageRegistryOptions = {}) {
    this.resolver = options.resolver;
    this.ringCapacity = options.ringCapacity ?? DEFAULT_RING_CAPACITY;
    this.rateWindowMs = options.rateWindowMs ?? DEFAULT_RATE_WINDOW_MS;
    this.rateMaxSamples = options.rateMaxSamples ?? DEFAULT_RATE_MAX_SAMPLES;
    this.clock = options.clock ?? (() => Date.now());
  }

  /**
   * Ingest one decoded message, updating its per-stream record and the per-link
   * loss stats. `nowMs` overrides the injected clock (deterministic in tests).
   */
  ingest(msg: DecodedMessage, nowMs?: number): void {
    const now = nowMs ?? this.clock();

    this.observedNameToId.set(msg.name, msg.msgId);
    if (!this.observedIdToName.has(msg.msgId)) {
      this.observedIdToName.set(msg.msgId, msg.name);
    }

    // Per-link sequence-gap / loss accounting (across all message ids).
    const lk = linkKey(msg.sysid, msg.compid);
    let link = this.links.get(lk);
    if (link === undefined) {
      link = new LinkLossTracker(msg.sysid, msg.compid);
      this.links.set(lk, link);
    }
    link.observe(msg.seq);

    // Per-(sysid, compid, msgId) stream stats.
    const key = msgKey(msg.sysid, msg.compid, msg.msgId);
    let stat = this.stats.get(key);
    if (stat === undefined) {
      stat = {
        sysid: msg.sysid,
        compid: msg.compid,
        msgId: msg.msgId,
        name: msg.name,
        latest: msg,
        lastSeenMs: now,
        count: 0,
        rateHz: 0,
        ring: new RingBuffer<DecodedMessage>(this.ringCapacity),
        rate: new SlidingWindowRate(this.rateWindowMs, this.rateMaxSamples),
      };
      this.stats.set(key, stat);
    }
    stat.latest = msg;
    stat.name = msg.name;
    stat.lastSeenMs = now;
    stat.count += 1;
    stat.ring.push(msg);
    stat.rate.add(now);
    stat.rateHz = stat.rate.value();
  }

  /** Numeric id for a name (observed first, then injected resolver), or self. */
  idOf(name: string): number | undefined {
    const observed = this.observedNameToId.get(name);
    if (observed !== undefined) return observed;
    return this.resolver?.idOf(name);
  }

  /** Name for a numeric id (observed first, then injected resolver). */
  nameOf(id: number): string | undefined {
    const observed = this.observedIdToName.get(id);
    if (observed !== undefined) return observed;
    return this.resolver?.nameOf(id);
  }

  /** Latest decoded message for a stream, or `undefined` if none seen. */
  latest(idOrName: number | string, sysid?: number, compid?: number): DecodedMessage | undefined {
    return this.findStat(idOrName, sysid, compid)?.latest;
  }

  /** Observed rate in Hz for a stream (0 if none / too few samples). */
  rate(idOrName: number | string, sysid?: number, compid?: number): number {
    return this.findStat(idOrName, sysid, compid)?.rateHz ?? 0;
  }

  /** Last-seen timestamp (registry clock domain) for a stream, or `undefined`. */
  lastSeen(idOrName: number | string, sysid?: number, compid?: number): number | undefined {
    return this.findStat(idOrName, sysid, compid)?.lastSeenMs;
  }

  /** Total ingested count for a stream (0 if none). */
  count(idOrName: number | string, sysid?: number, compid?: number): number {
    return this.findStat(idOrName, sysid, compid)?.count ?? 0;
  }

  /** Bounded ring of recent frames (oldest → newest); empty if none. */
  getRing(idOrName: number | string, sysid?: number, compid?: number): DecodedMessage[] {
    return this.findStat(idOrName, sysid, compid)?.ring.toArray() ?? [];
  }

  /** Full inspector record for a stream, or `undefined`. */
  getRecord(idOrName: number | string, sysid?: number, compid?: number): MessageRecord | undefined {
    const stat = this.findStat(idOrName, sysid, compid);
    return stat ? toRecord(stat) : undefined;
  }

  /** Distinct `(sysid, compid)` sources seen, sorted ascending. */
  listSystems(): SystemKey[] {
    const seen = new Set<string>();
    const out: SystemKey[] = [];
    for (const stat of this.stats.values()) {
      const k = linkKey(stat.sysid, stat.compid);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ sysid: stat.sysid, compid: stat.compid });
    }
    out.sort(bySystemThenMsg);
    return out;
  }

  /** Loss stats for one source, or `undefined` if it has not been seen. */
  linkStats(sysid: number, compid: number): LinkStats | undefined {
    return this.links.get(linkKey(sysid, compid))?.stats();
  }

  /** Loss stats for every source, sorted ascending. */
  listLinkStats(): LinkStats[] {
    const out: LinkStats[] = [];
    for (const link of this.links.values()) out.push(link.stats());
    out.sort(bySystemThenMsg);
    return out;
  }

  /** Snapshot of all stream records, sorted by `(sysid, compid, msgId)`. */
  snapshot(): MessageRecord[] {
    const out: MessageRecord[] = [];
    for (const stat of this.stats.values()) out.push(toRecord(stat));
    out.sort(bySystemThenMsg);
    return out;
  }

  /** Visit every stream record (snapshot copies; safe to retain). */
  forEach(callback: (record: MessageRecord) => void): void {
    for (const stat of this.stats.values()) callback(toRecord(stat));
  }

  /** Drop all accumulated state. */
  clear(): void {
    this.stats.clear();
    this.links.clear();
    this.observedNameToId.clear();
    this.observedIdToName.clear();
  }

  /**
   * Resolve a query target to a stream. With both `sysid` and `compid` given it
   * is an exact lookup; otherwise it returns the most-recently-seen matching
   * stream (deterministic for the common single-source case).
   */
  private findStat(
    idOrName: number | string,
    sysid?: number,
    compid?: number,
  ): MessageStat | undefined {
    const msgId = typeof idOrName === 'number' ? idOrName : this.idOf(idOrName);
    if (msgId === undefined) return undefined;

    if (sysid !== undefined && compid !== undefined) {
      return this.stats.get(msgKey(sysid, compid, msgId));
    }

    let best: MessageStat | undefined;
    for (const stat of this.stats.values()) {
      if (stat.msgId !== msgId) continue;
      if (sysid !== undefined && stat.sysid !== sysid) continue;
      if (compid !== undefined && stat.compid !== compid) continue;
      if (best === undefined || stat.lastSeenMs > best.lastSeenMs) best = stat;
    }
    return best;
  }
}
