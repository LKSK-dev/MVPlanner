/**
 * {@link LogClient} — MAVLink DataFlash log listing, resumable chunked download,
 * and erase over the classic `LOG_*` protocol (task T6.1; spec plan/03 §3.4
 * Log download, frozen contract {@link LogClientApi}).
 *
 * Design:
 *  - `list()` sends `LOG_REQUEST_LIST(start=0,end=0xffff)`, collects streamed
 *    `LOG_ENTRY` frames, and after a quiet window re-requests any missing entry
 *    id ranges until the advertised `num_logs` are present or a bounded stall
 *    timeout elapses.
 *  - `download(id)` uses the cached/listed `LOG_ENTRY.size` to preallocate the
 *    output buffer, sends `LOG_REQUEST_DATA(ofs=0,count=0xffffffff)`, writes
 *    `LOG_DATA` chunks by their `ofs`, merges received byte ranges, and
 *    periodically re-requests the current gaps. Out-of-order/duplicate chunks
 *    are safe; only newly-covered bytes advance progress. Completion sends
 *    `LOG_REQUEST_END` and returns a `Blob` containing the assembled bytes.
 *  - `erase()` sends `LOG_ERASE` to the active target (fire-and-forget; the
 *    protocol has no ACK).
 *
 * The classic `LOG_*` path is primary. An optional FTP client can be injected for
 * callers that want to layer firmware-specific file-log paths around this
 * service; the frozen `LogClient` methods intentionally keep using `LOG_*` for
 * deterministic interop and testability.
 */
import type {
  DecodedMessage,
  FieldValue,
  FtpClient as FtpClientApi,
  LogClient as LogClientApi,
  LogEntry,
} from '../../../contracts';
import { numField as num } from '../fields';
import {
  LOG_DATA,
  LOG_DATA_COUNT_ALL,
  LOG_DATA_MAX_BYTES,
  LOG_ENTRY,
  LOG_ERASE,
  LOG_LIST_END_ALL,
  LOG_REQUEST_DATA,
  LOG_REQUEST_END,
  LOG_REQUEST_LIST,
} from './constants';

/** Encode + send a message out the active link (bound to host `sendMessage`). */
export type LogSendFn = (name: string, fields: Record<string, unknown>) => void | Promise<void>;

/** Subscribe a selective decoded-message tap (bound to host `onMessage`). */
export type LogMessageTap = (
  names: readonly string[],
  cb: (msg: DecodedMessage) => void,
) => () => void;

/** Target (sysid/compid) addressed by each LOG_* request. */
export interface LogTarget {
  readonly sysid: number;
  readonly compid: number;
}

/** Returns the currently-active LOG target, or `undefined` when none is selected. */
export type LogTargetAccessor = () => LogTarget | undefined;

/**
 * Schedules `handler` after `ms`, returning a cancel function. Abstracted so
 * tests can drive quiet-window gap retries and timeouts deterministically.
 */
export interface LogClock {
  setTimeout(handler: () => void, ms: number): () => void;
}

/** Why a {@link LogError} occurred — drives caller handling / UI. */
export type LogErrorReason =
  | 'no-target'
  | 'aborted'
  | 'timeout'
  | 'not-found'
  | 'send-failed'
  | 'disposed';

/** A failed log operation: carries the {@link LogErrorReason}. */
export class LogError extends Error {
  constructor(
    message: string,
    readonly reason: LogErrorReason,
    /** The log id, when the failure concerns one log. */
    readonly logId?: number,
  ) {
    super(message);
    this.name = 'LogError';
  }
}

/** Construction dependencies for {@link LogClient}. */
export interface LogClientDeps {
  /** Encode + send a message (host `sendMessage`). */
  readonly sendMessage: LogSendFn;
  /** Subscribe a decoded-message tap (host `onMessage`). */
  readonly onMessage: LogMessageTap;
  /** Resolve the active LOG target (sysid/compid). */
  readonly getTarget: LogTargetAccessor;
  /** Timer source (default: global `setTimeout`/`clearTimeout`). */
  readonly clock?: LogClock;
  /** Optional firmware-file path client; classic LOG_* remains primary. */
  readonly ftp?: FtpClientApi;
  /** Quiet window with no new frames before checking gaps, ms (default 800). */
  readonly quietMs?: number;
  /** Max consecutive no-progress quiet windows before timeout (default 8). */
  readonly maxStallRounds?: number;
}

/** Default clock backed by the host environment's timer functions. */
const DEFAULT_CLOCK: LogClock = {
  setTimeout(handler: () => void, ms: number): () => void {
    const id = setTimeout(handler, ms);
    return () => clearTimeout(id);
  },
};

interface ByteRange {
  readonly start: number;
  readonly end: number;
}

interface BaseOp {
  readonly target: LogTarget;
  settled: boolean;
  cancelTimer?: () => void;
  abortCleanup?: () => void;
}

interface ListOp extends BaseOp {
  readonly entries: Map<number, LogEntry>;
  total: number | undefined;
  lastLogNum: number | undefined;
  lastCheckedCount: number;
  stallRounds: number;
  readonly resolve: (entries: LogEntry[]) => void;
  readonly reject: (err: LogError) => void;
}

interface DownloadOp extends BaseOp {
  readonly id: number;
  readonly total: number;
  readonly buffer: Uint8Array<ArrayBuffer>;
  readonly ranges: ByteRange[];
  receivedBytes: number;
  lastCheckedBytes: number;
  stallRounds: number;
  readonly onProgress?: (done: number, total: number) => void;
  readonly resolve: (blob: Blob) => void;
  readonly reject: (err: LogError) => void;
}

/** Read a `uint8_t[]` field as a byte array. */
function bytes(fields: Record<string, FieldValue>, key: string): readonly number[] | undefined {
  const v = fields[key];
  return Array.isArray(v) ? v : undefined;
}

/** Whether `msg` came from `target`. */
function fromTarget(msg: DecodedMessage, target: LogTarget): boolean {
  return msg.sysid === target.sysid && msg.compid === target.compid;
}

/** Build a sorted, public `LogEntry[]` from the id-indexed map. */
function sortedEntries(entries: ReadonlyMap<number, LogEntry>): LogEntry[] {
  return [...entries.values()].sort((a, b) => a.id - b.id);
}

/** Compute contiguous missing id ranges from the advertised log id window. */
function missingEntryRanges(op: ListOp): Array<{ start: number; end: number }> {
  if (op.total === undefined || op.lastLogNum === undefined)
    return [{ start: 0, end: LOG_LIST_END_ALL }];
  if (op.total <= 0) return [];
  const first = Math.max(0, op.lastLogNum - op.total + 1);
  const ranges: Array<{ start: number; end: number }> = [];
  let start: number | undefined;
  for (let id = first; id <= op.lastLogNum; id++) {
    if (!op.entries.has(id)) {
      if (start === undefined) start = id;
    } else if (start !== undefined) {
      ranges.push({ start, end: id - 1 });
      start = undefined;
    }
  }
  if (start !== undefined) ranges.push({ start, end: op.lastLogNum });
  return ranges;
}

/** Sum newly-covered bytes when inserting `[start,end)` into sorted ranges. */
function addRange(ranges: ByteRange[], start: number, end: number): number {
  if (end <= start) return 0;
  let newStart = start;
  let newEnd = end;
  let covered = 0;
  let insertAt = 0;

  while (insertAt < ranges.length) {
    const range = ranges[insertAt];
    if (range === undefined) return 0;
    if (range.end < newStart) {
      insertAt++;
      continue;
    }
    if (range.start > newEnd) break;
    covered += Math.max(0, Math.min(newEnd, range.end) - Math.max(newStart, range.start));
    newStart = Math.min(newStart, range.start);
    newEnd = Math.max(newEnd, range.end);
    ranges.splice(insertAt, 1);
  }

  ranges.splice(insertAt, 0, { start: newStart, end: newEnd });
  return end - start - covered;
}

/** Return the missing `[start,end)` byte ranges for a partially received file. */
function missingByteRanges(ranges: readonly ByteRange[], total: number): ByteRange[] {
  const gaps: ByteRange[] = [];
  let at = 0;
  for (const range of ranges) {
    if (range.start > at) gaps.push({ start: at, end: range.start });
    at = Math.max(at, range.end);
  }
  if (at < total) gaps.push({ start: at, end: total });
  return gaps;
}

/** Implements the frozen {@link LogClientApi} over an injected host send/tap pair. */
export class LogClient implements LogClientApi {
  private readonly sendMessage: LogSendFn;
  private readonly getTarget: LogTargetAccessor;
  private readonly clock: LogClock;
  private readonly quietMs: number;
  private readonly maxStallRounds: number;
  private readonly unsubscribe: () => void;
  private readonly listOps = new Set<ListOp>();
  private readonly downloadOps = new Set<DownloadOp>();
  private readonly cache = new Map<number, LogEntry>();
  private disposed = false;

  constructor(deps: LogClientDeps) {
    this.sendMessage = deps.sendMessage;
    this.getTarget = deps.getTarget;
    this.clock = deps.clock ?? DEFAULT_CLOCK;
    this.quietMs = deps.quietMs ?? 800;
    this.maxStallRounds = deps.maxStallRounds ?? 8;
    void deps.ftp;
    this.unsubscribe = deps.onMessage([LOG_ENTRY, LOG_DATA], (msg) => this.onMessage(msg));
  }

  /**
   * List vehicle logs with gap recovery. Resolves entries sorted by id and
   * updates the local size cache used by {@link download}.
   */
  list(signal?: AbortSignal): Promise<LogEntry[]> {
    return new Promise<LogEntry[]>((resolve, reject) => {
      if (this.disposed) {
        reject(new LogError('log client disposed', 'disposed'));
        return;
      }
      const target = this.getTarget();
      if (target === undefined) {
        reject(new LogError('no active vehicle/target', 'no-target'));
        return;
      }
      if (signal?.aborted === true) {
        reject(new LogError('log list aborted', 'aborted'));
        return;
      }

      const op: ListOp = {
        target,
        entries: new Map<number, LogEntry>(),
        total: undefined,
        lastLogNum: undefined,
        lastCheckedCount: 0,
        stallRounds: 0,
        settled: false,
        resolve,
        reject,
      };
      if (signal !== undefined) {
        const onAbort = (): void =>
          this.settleList(op, () => op.reject(new LogError('log list aborted', 'aborted')));
        signal.addEventListener('abort', onAbort, { once: true });
        op.abortCleanup = () => signal.removeEventListener('abort', onAbort);
      }

      this.listOps.add(op);
      this.sendListRequest(op.target, 0, LOG_LIST_END_ALL);
      op.cancelTimer = this.clock.setTimeout(() => this.onListQuiet(op), this.quietMs);
    });
  }

  /**
   * Download `id` into a `Blob`, recovering dropped chunks by re-requesting the
   * missing byte gaps until the cached entry size is fully covered.
   */
  async download(
    id: number,
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<Blob> {
    const entry = this.cache.get(id) ?? (await this.findEntryForDownload(id, signal));
    return this.downloadEntry(entry, onProgress, signal);
  }

  /** Send `LOG_ERASE` to the active target. The MAVLink LOG protocol has no ACK. */
  async erase(): Promise<void> {
    if (this.disposed) throw new LogError('log client disposed', 'disposed');
    const target = this.getTarget();
    if (target === undefined) throw new LogError('no active vehicle/target', 'no-target');
    await this.emit(LOG_ERASE, {
      target_system: target.sysid,
      target_component: target.compid,
    });
    // Erase invalidates every cached LOG_ENTRY size: ids get recycled.
    this.cache.clear();
  }

  /** Tear down: unsubscribe and reject in-flight operations. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const op of [...this.listOps]) {
      this.settleList(op, () => op.reject(new LogError('log client disposed', 'disposed')));
    }
    for (const op of [...this.downloadOps]) {
      this.settleDownload(op, () =>
        op.reject(new LogError('log client disposed', 'disposed', op.id)),
      );
    }
  }

  private async findEntryForDownload(
    id: number,
    signal: AbortSignal | undefined,
  ): Promise<LogEntry> {
    const entries = await this.list(signal);
    const entry = entries.find((e) => e.id === id);
    if (entry === undefined) throw new LogError(`log ${id} not found`, 'not-found', id);
    return entry;
  }

  private downloadEntry(
    entry: LogEntry,
    onProgress: ((done: number, total: number) => void) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Blob> {
    return new Promise<Blob>((resolve, reject) => {
      if (this.disposed) {
        reject(new LogError('log client disposed', 'disposed', entry.id));
        return;
      }
      const target = this.getTarget();
      if (target === undefined) {
        reject(new LogError('no active vehicle/target', 'no-target', entry.id));
        return;
      }
      if (signal?.aborted === true) {
        reject(new LogError('log download aborted', 'aborted', entry.id));
        return;
      }
      if (entry.sizeBytes === 0) {
        onProgress?.(0, 0);
        this.sendRequestEnd(target);
        resolve(new Blob([new Uint8Array(0)]));
        return;
      }

      const op: DownloadOp = {
        target,
        id: entry.id,
        total: entry.sizeBytes,
        buffer: new Uint8Array(entry.sizeBytes),
        ranges: [],
        receivedBytes: 0,
        lastCheckedBytes: 0,
        stallRounds: 0,
        settled: false,
        ...(onProgress !== undefined ? { onProgress } : {}),
        resolve,
        reject,
      };
      if (signal !== undefined) {
        const onAbort = (): void => {
          this.sendRequestEnd(op.target);
          this.settleDownload(op, () =>
            op.reject(new LogError('log download aborted', 'aborted', op.id)),
          );
        };
        signal.addEventListener('abort', onAbort, { once: true });
        op.abortCleanup = () => signal.removeEventListener('abort', onAbort);
      }

      this.downloadOps.add(op);
      op.onProgress?.(0, op.total);
      this.sendDataRequest(op.target, op.id, 0, LOG_DATA_COUNT_ALL);
      op.cancelTimer = this.clock.setTimeout(() => this.onDownloadQuiet(op), this.quietMs);
    });
  }

  private onMessage(msg: DecodedMessage): void {
    if (msg.name === LOG_ENTRY) {
      this.onLogEntry(msg);
    } else if (msg.name === LOG_DATA) {
      this.onLogData(msg);
    }
  }

  private onLogEntry(msg: DecodedMessage): void {
    for (const op of [...this.listOps]) {
      if (!fromTarget(msg, op.target) || op.settled) continue;
      const id = num(msg.fields, 'id');
      const size = num(msg.fields, 'size');
      const numLogs = num(msg.fields, 'num_logs');
      const lastLogNum = num(msg.fields, 'last_log_num');
      const timeUtc = num(msg.fields, 'time_utc');

      if (numLogs !== undefined) op.total = numLogs;
      if (lastLogNum !== undefined) op.lastLogNum = lastLogNum;
      if (op.total === 0) {
        this.settleList(op, () => op.resolve([]));
        continue;
      }
      if (id === undefined || size === undefined) continue;
      const entry: LogEntry = {
        id,
        sizeBytes: size,
        ...(timeUtc !== undefined && timeUtc > 0 ? { utc: timeUtc } : {}),
      };
      op.entries.set(id, entry);
      this.cache.set(id, entry);
      op.cancelTimer?.();
      op.cancelTimer = this.clock.setTimeout(() => this.onListQuiet(op), this.quietMs);
      this.tryResolveList(op);
    }
  }

  private onLogData(msg: DecodedMessage): void {
    const id = num(msg.fields, 'id');
    const offset = num(msg.fields, 'ofs');
    const count = num(msg.fields, 'count');
    const data = bytes(msg.fields, 'data');
    if (id === undefined || offset === undefined || count === undefined || data === undefined) {
      return;
    }

    for (const op of [...this.downloadOps]) {
      if (!fromTarget(msg, op.target) || op.settled || op.id !== id) continue;
      if (offset >= op.total) continue;
      const valid = Math.min(count, data.length, LOG_DATA_MAX_BYTES, op.total - offset);
      if (valid <= 0) continue;
      for (let i = 0; i < valid; i++) {
        const value = data[i];
        if (value === undefined) break;
        op.buffer[offset + i] = value & 0xff;
      }
      const added = addRange(op.ranges, offset, offset + valid);
      if (added > 0) {
        op.receivedBytes += added;
        op.onProgress?.(op.receivedBytes, op.total);
        op.cancelTimer?.();
        op.cancelTimer = this.clock.setTimeout(() => this.onDownloadQuiet(op), this.quietMs);
      }
      if (op.receivedBytes >= op.total) {
        this.completeDownload(op);
      }
    }
  }

  private onListQuiet(op: ListOp): void {
    if (op.settled) return;
    if (this.tryResolveList(op)) return;

    const count = op.entries.size;
    const progressed = count > op.lastCheckedCount;
    op.lastCheckedCount = count;
    op.stallRounds = progressed ? 0 : op.stallRounds + 1;
    if (op.stallRounds > this.maxStallRounds) {
      this.settleList(op, () =>
        op.reject(
          new LogError(`log list timed out after ${op.stallRounds} stalled rounds`, 'timeout'),
        ),
      );
      return;
    }

    for (const range of missingEntryRanges(op)) {
      this.sendListRequest(op.target, range.start, range.end);
    }
    op.cancelTimer = this.clock.setTimeout(() => this.onListQuiet(op), this.quietMs);
  }

  private onDownloadQuiet(op: DownloadOp): void {
    if (op.settled) return;
    if (op.receivedBytes >= op.total) {
      this.completeDownload(op);
      return;
    }

    const progressed = op.receivedBytes > op.lastCheckedBytes;
    op.lastCheckedBytes = op.receivedBytes;
    op.stallRounds = progressed ? 0 : op.stallRounds + 1;
    if (op.stallRounds > this.maxStallRounds) {
      this.sendRequestEnd(op.target);
      this.settleDownload(op, () =>
        op.reject(
          new LogError(
            `log ${op.id} download timed out at ${op.receivedBytes}/${op.total}`,
            'timeout',
            op.id,
          ),
        ),
      );
      return;
    }

    for (const gap of missingByteRanges(op.ranges, op.total)) {
      this.sendDataRequest(op.target, op.id, gap.start, gap.end - gap.start);
    }
    op.cancelTimer = this.clock.setTimeout(() => this.onDownloadQuiet(op), this.quietMs);
  }

  private tryResolveList(op: ListOp): boolean {
    if (op.total !== undefined && op.total <= 0) {
      this.settleList(op, () => op.resolve([]));
      return true;
    }
    if (op.total !== undefined && op.entries.size >= op.total) {
      const entries = sortedEntries(op.entries);
      this.settleList(op, () => op.resolve(entries));
      return true;
    }
    return false;
  }

  private completeDownload(op: DownloadOp): void {
    this.sendRequestEnd(op.target);
    const blob = new Blob([op.buffer]);
    this.settleDownload(op, () => op.resolve(blob));
  }

  private settleList(op: ListOp, done: () => void): void {
    if (op.settled) return;
    op.settled = true;
    op.cancelTimer?.();
    op.abortCleanup?.();
    this.listOps.delete(op);
    done();
  }

  private settleDownload(op: DownloadOp, done: () => void): void {
    if (op.settled) return;
    op.settled = true;
    op.cancelTimer?.();
    op.abortCleanup?.();
    this.downloadOps.delete(op);
    done();
  }

  private sendListRequest(target: LogTarget, start: number, end: number): void {
    this.emit(LOG_REQUEST_LIST, {
      target_system: target.sysid,
      target_component: target.compid,
      start,
      end,
    }).catch(() => undefined);
  }

  private sendDataRequest(target: LogTarget, id: number, ofs: number, count: number): void {
    this.emit(LOG_REQUEST_DATA, {
      target_system: target.sysid,
      target_component: target.compid,
      id,
      ofs,
      count,
    }).catch(() => undefined);
  }

  private sendRequestEnd(target: LogTarget): void {
    this.emit(LOG_REQUEST_END, {
      target_system: target.sysid,
      target_component: target.compid,
    }).catch(() => undefined);
  }

  private async emit(name: string, fields: Record<string, unknown>): Promise<void> {
    try {
      await this.sendMessage(name, fields);
    } catch (err) {
      throw new LogError(
        `failed to send ${name}: ${err instanceof Error ? err.message : String(err)}`,
        'send-failed',
      );
    }
  }
}

/** Construct a {@link LogClient} (ergonomic factory mirroring sibling services). */
export function createLogClient(deps: LogClientDeps): LogClient {
  return new LogClient(deps);
}
