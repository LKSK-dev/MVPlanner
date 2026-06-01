/**
 * {@link MissionClient} — the MAVLink mission-protocol microservice for all
 * three `MAV_MISSION_TYPE`s (mission / fence / rally) (task T4.1; spec plan/03
 * §3.4 Mission, contract {@link MissionClientApi}).
 *
 * Implements the half-duplex item-transfer handshake over `MISSION_*`:
 *
 *  - `download(type)` sends `MISSION_REQUEST_LIST`, awaits `MISSION_COUNT`, then
 *    pulls each item `0..count-1` with `MISSION_REQUEST_INT` (retrying the
 *    current item on timeout), collects the `MISSION_ITEM_INT`s, sends the final
 *    `MISSION_ACK`, and resolves a {@link Mission}.
 *  - `upload(m)` sends `MISSION_COUNT`, answers each inbound
 *    `MISSION_REQUEST_INT` / `MISSION_REQUEST(seq)` with the matching
 *    `MISSION_ITEM_INT`, and resolves on a terminal `MISSION_ACK(ACCEPTED)`
 *    (rejecting any other `MAV_MISSION_RESULT`). With `verify`, it re-downloads
 *    and compares the read-back to the uploaded items.
 *  - `clear(type)` sends `MISSION_CLEAR_ALL` and awaits its `MISSION_ACK`.
 *  - `setCurrent(seq)` sends `MISSION_SET_CURRENT` (fire-and-forget).
 *  - `onCurrent` / `onReached` surface `MISSION_CURRENT` / `MISSION_ITEM_REACHED`.
 *
 * `MISSION_ITEM_INT` carries lat/lon as 1e7-scaled integers in `x`/`y` and a
 * float `z`; the frozen {@link MissionItem} shape is preserved verbatim on both
 * directions (the caller owns the int scaling, mirroring the contract).
 *
 * Pure logic: the host seam ({@link MissionSendFn} / {@link MissionMessageTap}),
 * the target accessor, and the {@link MissionClock} are all injected, so the
 * client unit-tests against a mock host and a fake clock with no worker.
 */
import type { MissionClient as MissionClientApi } from '../../../contracts';
import type {
  DecodedMessage,
  FieldValue,
  Mission,
  MissionItem,
  MissionType,
} from '../../../contracts';
import { MAV_MISSION_ACCEPTED, missionResultName, missionTypeValue } from './constants';

/** Encode + send a message out the active link (bound to host `sendMessage`). */
export type MissionSendFn = (name: string, fields: Record<string, unknown>) => void | Promise<void>;

/** Subscribe a selective decoded-message tap (bound to host `onMessage`). */
export type MissionMessageTap = (
  names: readonly string[],
  cb: (msg: DecodedMessage) => void,
) => () => void;

/** Target (sysid/compid) a mission transfer is addressed to. */
export interface MissionTarget {
  readonly sysid: number;
  readonly compid: number;
}

/** Returns the currently-active mission target, or `undefined` when none. */
export type MissionTargetAccessor = () => MissionTarget | undefined;

/**
 * Schedules `handler` after `ms`, returning a cancel function. Abstracted so
 * tests drive item retries / timeouts with a deterministic fake clock.
 */
export interface MissionClock {
  setTimeout(handler: () => void, ms: number): () => void;
}

/** Why a {@link MissionError} occurred — drives caller handling / UI. */
export type MissionErrorReason =
  | 'no-target'
  | 'aborted'
  | 'timeout'
  | 'rejected'
  | 'send-failed'
  | 'verify'
  | 'disposed';

/** A failed mission operation: carries the {@link MissionErrorReason}. */
export class MissionError extends Error {
  constructor(
    message: string,
    readonly reason: MissionErrorReason,
    /** The `MAV_MISSION_RESULT` when the failure is a rejected ACK. */
    readonly result?: number,
  ) {
    super(message);
    this.name = 'MissionError';
  }
}

/** Construction dependencies for {@link MissionClient}. */
export interface MissionClientDeps {
  /** Encode + send a message (host `sendMessage`). */
  readonly sendMessage: MissionSendFn;
  /** Subscribe a decoded-message tap (host `onMessage`). */
  readonly onMessage: MissionMessageTap;
  /** Resolve the active mission target (sysid/compid). */
  readonly getTarget: MissionTargetAccessor;
  /** Timer source (default: global `setTimeout`/`clearTimeout`). */
  readonly clock?: MissionClock;
  /** Per-step resend interval (count / item / clear), ms (default 1500). */
  readonly resendMs?: number;
  /** Max send attempts per step before a timeout rejection (default 5). */
  readonly maxAttempts?: number;
}

/** Options accepted by {@link MissionClient.upload}. */
export interface MissionUploadOpts {
  verify?: boolean;
  onProgress?: (i: number, n: number) => void;
  signal?: AbortSignal;
}

/** Default clock backed by the host environment's timer functions. */
const DEFAULT_CLOCK: MissionClock = {
  setTimeout(handler: () => void, ms: number): () => void {
    const id = setTimeout(handler, ms);
    return () => clearTimeout(id);
  },
};

/** Read a scalar field as a number (coercing bigint); `undefined` otherwise. */
function num(fields: Record<string, FieldValue>, key: string): number | undefined {
  const v = fields[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return undefined;
}

/** Build a frozen {@link MissionItem} from a decoded `MISSION_ITEM_INT`. */
function itemFromMessage(fields: Record<string, FieldValue>): MissionItem {
  return {
    seq: num(fields, 'seq') ?? 0,
    frame: num(fields, 'frame') ?? 0,
    command: num(fields, 'command') ?? 0,
    current: num(fields, 'current') ?? 0,
    autocontinue: num(fields, 'autocontinue') ?? 0,
    params: [
      num(fields, 'param1') ?? 0,
      num(fields, 'param2') ?? 0,
      num(fields, 'param3') ?? 0,
      num(fields, 'param4') ?? 0,
    ],
    x: num(fields, 'x') ?? 0,
    y: num(fields, 'y') ?? 0,
    z: num(fields, 'z') ?? 0,
  };
}

/**
 * Whether two item lists are equivalent for read-back verification. The
 * `current` flag is intentionally ignored: the vehicle commonly re-flags the
 * active waypoint (e.g. item 0) on read-back, so comparing it would spuriously
 * fail an otherwise-correct upload. All geometry/command fields must match.
 */
function missionsEqual(a: readonly MissionItem[], b: readonly MissionItem[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return false;
    if (
      x.seq !== y.seq ||
      x.frame !== y.frame ||
      x.command !== y.command ||
      x.autocontinue !== y.autocontinue ||
      x.x !== y.x ||
      x.y !== y.y ||
      x.z !== y.z ||
      x.params[0] !== y.params[0] ||
      x.params[1] !== y.params[1] ||
      x.params[2] !== y.params[2] ||
      x.params[3] !== y.params[3]
    ) {
      return false;
    }
  }
  return true;
}

/** One in-flight `download` collecting the items of a single mission type. */
interface DownloadOp {
  readonly type: MissionType;
  readonly missionType: number;
  readonly target: MissionTarget;
  phase: 'count' | 'items';
  count: number;
  expectedSeq: number;
  attempts: number;
  readonly items: Map<number, MissionItem>;
  settled: boolean;
  cancelTimer?: () => void;
  abortCleanup?: () => void;
  readonly onProgress?: (i: number, n: number) => void;
  readonly resolve: (m: Mission) => void;
  readonly reject: (e: MissionError) => void;
}

/** One in-flight `upload` streaming items in response to vehicle requests. */
interface UploadOp {
  readonly type: MissionType;
  readonly missionType: number;
  readonly target: MissionTarget;
  readonly items: readonly MissionItem[];
  readonly count: number;
  readonly verify: boolean;
  readonly signal?: AbortSignal;
  phase: 'count' | 'items';
  lastSeq: number;
  attempts: number;
  settled: boolean;
  cancelTimer?: () => void;
  abortCleanup?: () => void;
  readonly onProgress?: (i: number, n: number) => void;
  readonly resolve: () => void;
  readonly reject: (e: MissionError) => void;
}

/** One in-flight `clear` awaiting its `MISSION_ACK`. */
interface ClearOp {
  readonly missionType: number;
  readonly target: MissionTarget;
  attempts: number;
  settled: boolean;
  cancelTimer?: () => void;
  readonly resolve: () => void;
  readonly reject: (e: MissionError) => void;
}

/**
 * Implements the frozen {@link MissionClientApi} on top of an injected host
 * send/tap pair. See the file header and ./README.md for the contract.
 */
export class MissionClient implements MissionClientApi {
  private readonly sendMessage: MissionSendFn;
  private readonly getTarget: MissionTargetAccessor;
  private readonly clock: MissionClock;
  private readonly resendMs: number;
  private readonly maxAttempts: number;

  private readonly downloads = new Set<DownloadOp>();
  private readonly uploads = new Set<UploadOp>();
  private readonly clears = new Set<ClearOp>();
  private readonly currentListeners = new Set<(seq: number) => void>();
  private readonly reachedListeners = new Set<(seq: number) => void>();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(deps: MissionClientDeps) {
    this.sendMessage = deps.sendMessage;
    this.getTarget = deps.getTarget;
    this.clock = deps.clock ?? DEFAULT_CLOCK;
    this.resendMs = deps.resendMs ?? 1500;
    this.maxAttempts = deps.maxAttempts ?? 5;
    this.unsubscribe = deps.onMessage(
      [
        'MISSION_COUNT',
        'MISSION_ITEM_INT',
        'MISSION_ACK',
        'MISSION_REQUEST_INT',
        'MISSION_REQUEST',
        'MISSION_CURRENT',
        'MISSION_ITEM_REACHED',
      ],
      (msg) => this.onMessage(msg),
    );
  }

  /**
   * Download all items of `type`. Sends `MISSION_REQUEST_LIST`, awaits
   * `MISSION_COUNT`, pulls each item with `MISSION_REQUEST_INT` (retrying the
   * current item on timeout), sends the final `MISSION_ACK`, and resolves the
   * {@link Mission}. `onProgress(i, n)` fires per received item. Rejects on
   * no-target, abort, or a bounded per-step timeout.
   */
  download(
    type: MissionType,
    onProgress?: (i: number, n: number) => void,
    signal?: AbortSignal,
  ): Promise<Mission> {
    return new Promise<Mission>((resolve, reject) => {
      if (this.disposed) {
        reject(new MissionError('mission client disposed', 'disposed'));
        return;
      }
      const target = this.getTarget();
      if (target === undefined) {
        reject(new MissionError('no active vehicle/target', 'no-target'));
        return;
      }
      if (signal?.aborted === true) {
        reject(new MissionError('download aborted', 'aborted'));
        return;
      }
      const op: DownloadOp = {
        type,
        missionType: missionTypeValue(type),
        target,
        phase: 'count',
        count: 0,
        expectedSeq: 0,
        attempts: 1,
        items: new Map<number, MissionItem>(),
        settled: false,
        resolve,
        reject,
        ...(onProgress !== undefined ? { onProgress } : {}),
      };
      if (signal !== undefined) {
        const onAbort = (): void => {
          this.settleDownload(op, () => op.reject(new MissionError('download aborted', 'aborted')));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        op.abortCleanup = () => signal.removeEventListener('abort', onAbort);
      }
      this.downloads.add(op);
      this.sendRequestList(op.target, op.missionType);
      op.cancelTimer = this.clock.setTimeout(() => this.onDownloadTick(op), this.resendMs);
    });
  }

  /**
   * Upload `m` to the vehicle. Sends `MISSION_COUNT`, answers each inbound
   * `MISSION_REQUEST_INT` / `MISSION_REQUEST(seq)` with the matching
   * `MISSION_ITEM_INT`, and resolves on `MISSION_ACK(MAV_MISSION_ACCEPTED)`.
   * Any other result rejects with `MissionError('rejected', result)`. With
   * `opts.verify`, the items are re-downloaded and compared (rejecting
   * `MissionError('verify')` on a mismatch). `onProgress(i, n)` reports the
   * highest answered item. Rejects on no-target, abort, or a bounded timeout.
   */
  upload(m: Mission, opts: MissionUploadOpts = {}): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.disposed) {
        reject(new MissionError('mission client disposed', 'disposed'));
        return;
      }
      const target = this.getTarget();
      if (target === undefined) {
        reject(new MissionError('no active vehicle/target', 'no-target'));
        return;
      }
      const signal = opts.signal;
      if (signal?.aborted === true) {
        reject(new MissionError('upload aborted', 'aborted'));
        return;
      }
      const items = [...m.items];
      const op: UploadOp = {
        type: m.type,
        missionType: missionTypeValue(m.type),
        target,
        items,
        count: items.length,
        verify: opts.verify ?? false,
        phase: 'count',
        lastSeq: -1,
        attempts: 1,
        settled: false,
        resolve,
        reject,
        ...(signal !== undefined ? { signal } : {}),
        ...(opts.onProgress !== undefined ? { onProgress: opts.onProgress } : {}),
      };
      if (signal !== undefined) {
        const onAbort = (): void => {
          this.settleUpload(op, () => op.reject(new MissionError('upload aborted', 'aborted')));
        };
        signal.addEventListener('abort', onAbort, { once: true });
        op.abortCleanup = () => signal.removeEventListener('abort', onAbort);
      }
      this.uploads.add(op);
      this.sendCount(op.target, op.count, op.missionType);
      op.cancelTimer = this.clock.setTimeout(() => this.onUploadTick(op), this.resendMs);
    });
  }

  /**
   * Clear all items of `type` via `MISSION_CLEAR_ALL`, awaiting the terminal
   * `MISSION_ACK`. Resolves on `MAV_MISSION_ACCEPTED`; rejects on any other
   * result or a bounded timeout.
   */
  clear(type: MissionType): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.disposed) {
        reject(new MissionError('mission client disposed', 'disposed'));
        return;
      }
      const target = this.getTarget();
      if (target === undefined) {
        reject(new MissionError('no active vehicle/target', 'no-target'));
        return;
      }
      const op: ClearOp = {
        missionType: missionTypeValue(type),
        target,
        attempts: 1,
        settled: false,
        resolve,
        reject,
      };
      this.clears.add(op);
      this.sendClearAll(op.target, op.missionType);
      op.cancelTimer = this.clock.setTimeout(() => this.onClearTick(op), this.resendMs);
    });
  }

  /** Jump the active mission to `seq` via `MISSION_SET_CURRENT` (fire-and-forget). */
  async setCurrent(seq: number): Promise<void> {
    const target = this.getTarget();
    if (target === undefined) throw new MissionError('no active vehicle/target', 'no-target');
    await Promise.resolve(
      this.sendMessage('MISSION_SET_CURRENT', {
        target_system: target.sysid,
        target_component: target.compid,
        seq,
      }),
    );
  }

  /** Subscribe to `MISSION_CURRENT.seq` updates; returns an unsubscribe fn. */
  onCurrent(cb: (seq: number) => void): () => void {
    this.currentListeners.add(cb);
    return () => {
      this.currentListeners.delete(cb);
    };
  }

  /** Subscribe to `MISSION_ITEM_REACHED.seq` events; returns an unsubscribe fn. */
  onReached(cb: (seq: number) => void): () => void {
    this.reachedListeners.add(cb);
    return () => {
      this.reachedListeners.delete(cb);
    };
  }

  /**
   * Tear down: unsubscribe the mission tap and reject any in-flight
   * download/upload/clear operations. Not part of the frozen interface; call
   * when discarding the client.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const op of [...this.downloads]) {
      this.settleDownload(op, () =>
        op.reject(new MissionError('mission client disposed', 'disposed')),
      );
    }
    for (const op of [...this.uploads]) {
      this.settleUpload(op, () =>
        op.reject(new MissionError('mission client disposed', 'disposed')),
      );
    }
    for (const op of [...this.clears]) {
      this.settleClear(op, () =>
        op.reject(new MissionError('mission client disposed', 'disposed')),
      );
    }
    this.currentListeners.clear();
    this.reachedListeners.clear();
  }

  // --- message dispatch ---------------------------------------------------

  /** Route an incoming mission message to the relevant in-flight op / listeners. */
  private onMessage(msg: DecodedMessage): void {
    switch (msg.name) {
      case 'MISSION_COUNT':
        this.onCount(msg);
        return;
      case 'MISSION_ITEM_INT':
        this.onItemInt(msg);
        return;
      case 'MISSION_ACK':
        this.onAck(msg);
        return;
      case 'MISSION_REQUEST_INT':
      case 'MISSION_REQUEST':
        this.onItemRequest(msg);
        return;
      case 'MISSION_CURRENT': {
        const seq = num(msg.fields, 'seq');
        if (seq !== undefined) for (const cb of this.currentListeners) cb(seq);
        return;
      }
      case 'MISSION_ITEM_REACHED': {
        const seq = num(msg.fields, 'seq');
        if (seq !== undefined) for (const cb of this.reachedListeners) cb(seq);
        return;
      }
      default:
        return;
    }
  }

  /** Find the in-flight op (download/upload) matching a message's type+source. */
  private matchDownload(msg: DecodedMessage): DownloadOp | undefined {
    const mt = num(msg.fields, 'mission_type') ?? 0;
    for (const op of this.downloads) {
      if (!op.settled && op.missionType === mt && op.target.sysid === msg.sysid) return op;
    }
    return undefined;
  }

  private matchUpload(msg: DecodedMessage): UploadOp | undefined {
    const mt = num(msg.fields, 'mission_type') ?? 0;
    for (const op of this.uploads) {
      if (!op.settled && op.missionType === mt && op.target.sysid === msg.sysid) return op;
    }
    return undefined;
  }

  // --- download state machine --------------------------------------------

  /** Handle `MISSION_COUNT` — start (or restart) the item-pull phase. */
  private onCount(msg: DecodedMessage): void {
    const op = this.matchDownload(msg);
    if (op === undefined || op.phase !== 'count') return;
    const count = num(msg.fields, 'count') ?? 0;
    op.count = count;
    if (count <= 0) {
      this.sendAck(op.target, op.missionType);
      this.settleDownload(op, () => op.resolve({ type: op.type, items: [] }));
      return;
    }
    op.phase = 'items';
    op.expectedSeq = 0;
    op.attempts = 1;
    this.sendRequestInt(op.target, 0, op.missionType);
    this.restartDownloadTimer(op);
  }

  /** Handle `MISSION_ITEM_INT` — record the expected item and advance. */
  private onItemInt(msg: DecodedMessage): void {
    const op = this.matchDownload(msg);
    if (op === undefined || op.phase !== 'items') return;
    const seq = num(msg.fields, 'seq');
    if (seq === undefined || seq !== op.expectedSeq) return; // duplicate / out-of-order
    op.items.set(seq, itemFromMessage(msg.fields));
    op.onProgress?.(op.items.size, op.count);

    if (op.items.size >= op.count) {
      this.sendAck(op.target, op.missionType);
      this.settleDownload(op, () => op.resolve(this.buildMission(op)));
      return;
    }
    op.expectedSeq += 1;
    op.attempts = 1;
    this.sendRequestInt(op.target, op.expectedSeq, op.missionType);
    this.restartDownloadTimer(op);
  }

  /** Per-step timeout: resend the current request (bounded) or reject. */
  private onDownloadTick(op: DownloadOp): void {
    if (op.settled) return;
    if (op.attempts >= this.maxAttempts) {
      this.settleDownload(op, () =>
        op.reject(
          new MissionError(
            op.phase === 'count'
              ? `mission ${op.type} count timed out after ${op.attempts} attempts`
              : `mission ${op.type} item ${op.expectedSeq} timed out after ${op.attempts} attempts`,
            'timeout',
          ),
        ),
      );
      return;
    }
    op.attempts += 1;
    if (op.phase === 'count') this.sendRequestList(op.target, op.missionType);
    else this.sendRequestInt(op.target, op.expectedSeq, op.missionType);
    this.restartDownloadTimer(op);
  }

  /** Assemble the resolved {@link Mission}, items ordered by seq. */
  private buildMission(op: DownloadOp): Mission {
    const seqs = [...op.items.keys()].sort((a, b) => a - b);
    const items: MissionItem[] = [];
    for (const s of seqs) {
      const it = op.items.get(s);
      if (it !== undefined) items.push(it);
    }
    return { type: op.type, items };
  }

  private restartDownloadTimer(op: DownloadOp): void {
    op.cancelTimer?.();
    op.cancelTimer = this.clock.setTimeout(() => this.onDownloadTick(op), this.resendMs);
  }

  // --- upload state machine ----------------------------------------------

  /** Handle `MISSION_REQUEST_INT` / `MISSION_REQUEST` — send the asked item. */
  private onItemRequest(msg: DecodedMessage): void {
    const op = this.matchUpload(msg);
    if (op === undefined) return;
    const seq = num(msg.fields, 'seq');
    if (seq === undefined || seq < 0 || seq >= op.count) return;
    const item = op.items[seq] ?? op.items.find((i) => i.seq === seq);
    if (item === undefined) return;
    op.phase = 'items';
    op.lastSeq = seq;
    op.attempts = 1;
    this.sendItemInt(op.target, item, op.missionType);
    op.onProgress?.(seq + 1, op.count);
    op.cancelTimer?.();
    op.cancelTimer = this.clock.setTimeout(() => this.onUploadTick(op), this.resendMs);
  }

  /**
   * Handle a terminal `MISSION_ACK`. The same message ends both an upload (the
   * vehicle's verdict) and a clear; prefer a matching upload, then a clear.
   */
  private onAck(msg: DecodedMessage): void {
    const result = num(msg.fields, 'type') ?? 0;
    const upload = this.matchUpload(msg);
    if (upload !== undefined) {
      if (result === MAV_MISSION_ACCEPTED) {
        this.settleUpload(upload, () => this.finishUpload(upload));
        return;
      }
      this.settleUpload(upload, () =>
        upload.reject(
          new MissionError(
            `mission ${upload.type} upload rejected: ${missionResultName(result)}`,
            'rejected',
            result,
          ),
        ),
      );
      return;
    }
    const mt = num(msg.fields, 'mission_type') ?? 0;
    const clearOp = [...this.clears].find(
      (c) => !c.settled && c.target.sysid === msg.sysid && c.missionType === mt,
    );
    if (clearOp !== undefined) this.finishClear(clearOp, result);
  }

  /** Resolve an accepted upload, optionally after a read-back verify. */
  private finishUpload(op: UploadOp): void {
    if (!op.verify) {
      op.resolve();
      return;
    }
    this.download(op.type, undefined, op.signal)
      .then((m) => {
        if (missionsEqual(op.items, m.items)) op.resolve();
        else
          op.reject(
            new MissionError(
              `mission ${op.type} verify mismatch (${op.items.length} sent, ${m.items.length} read back)`,
              'verify',
            ),
          );
      })
      .catch((err: unknown) => {
        op.reject(
          err instanceof MissionError
            ? err
            : new MissionError(
                `mission ${op.type} verify failed: ${err instanceof Error ? err.message : String(err)}`,
                'verify',
              ),
        );
      });
  }

  /** Per-step timeout: resend COUNT (count phase) or the last item (item phase). */
  private onUploadTick(op: UploadOp): void {
    if (op.settled) return;
    if (op.attempts >= this.maxAttempts) {
      this.settleUpload(op, () =>
        op.reject(
          new MissionError(
            `mission ${op.type} upload timed out after ${op.attempts} attempts`,
            'timeout',
          ),
        ),
      );
      return;
    }
    op.attempts += 1;
    if (op.phase === 'count' || op.lastSeq < 0) {
      this.sendCount(op.target, op.count, op.missionType);
    } else {
      const item = op.items[op.lastSeq] ?? op.items.find((i) => i.seq === op.lastSeq);
      if (item !== undefined) this.sendItemInt(op.target, item, op.missionType);
    }
    op.cancelTimer = this.clock.setTimeout(() => this.onUploadTick(op), this.resendMs);
  }

  // --- clear state machine -----------------------------------------------

  /** Terminal `MISSION_ACK` for a clear: accepted resolves, else rejects. */
  private finishClear(op: ClearOp, result: number): void {
    if (result === MAV_MISSION_ACCEPTED) {
      this.settleClear(op, () => op.resolve());
      return;
    }
    this.settleClear(op, () =>
      op.reject(
        new MissionError(
          `mission clear rejected: ${missionResultName(result)}`,
          'rejected',
          result,
        ),
      ),
    );
  }

  /** Per-step timeout: resend `MISSION_CLEAR_ALL` (bounded) or reject. */
  private onClearTick(op: ClearOp): void {
    if (op.settled) return;
    if (op.attempts >= this.maxAttempts) {
      this.settleClear(op, () =>
        op.reject(
          new MissionError(`mission clear timed out after ${op.attempts} attempts`, 'timeout'),
        ),
      );
      return;
    }
    op.attempts += 1;
    this.sendClearAll(op.target, op.missionType);
    op.cancelTimer = this.clock.setTimeout(() => this.onClearTick(op), this.resendMs);
  }

  // --- wire senders -------------------------------------------------------

  private sendRequestList(target: MissionTarget, missionType: number): void {
    this.emit('MISSION_REQUEST_LIST', {
      target_system: target.sysid,
      target_component: target.compid,
      mission_type: missionType,
    });
  }

  private sendRequestInt(target: MissionTarget, seq: number, missionType: number): void {
    this.emit('MISSION_REQUEST_INT', {
      target_system: target.sysid,
      target_component: target.compid,
      seq,
      mission_type: missionType,
    });
  }

  private sendCount(target: MissionTarget, count: number, missionType: number): void {
    this.emit('MISSION_COUNT', {
      target_system: target.sysid,
      target_component: target.compid,
      count,
      mission_type: missionType,
    });
  }

  private sendItemInt(target: MissionTarget, item: MissionItem, missionType: number): void {
    this.emit('MISSION_ITEM_INT', {
      target_system: target.sysid,
      target_component: target.compid,
      seq: item.seq,
      frame: item.frame,
      command: item.command,
      current: item.current,
      autocontinue: item.autocontinue,
      param1: item.params[0],
      param2: item.params[1],
      param3: item.params[2],
      param4: item.params[3],
      x: item.x,
      y: item.y,
      z: item.z,
      mission_type: missionType,
    });
  }

  private sendAck(target: MissionTarget, missionType: number): void {
    this.emit('MISSION_ACK', {
      target_system: target.sysid,
      target_component: target.compid,
      type: MAV_MISSION_ACCEPTED,
      mission_type: missionType,
    });
  }

  private sendClearAll(target: MissionTarget, missionType: number): void {
    this.emit('MISSION_CLEAR_ALL', {
      target_system: target.sysid,
      target_component: target.compid,
      mission_type: missionType,
    });
  }

  /** Fire-and-forget send; surfaces a send failure to any matching in-flight op. */
  private emit(name: string, fields: Record<string, unknown>): void {
    const onError = (err: unknown): void => {
      const message = `failed to send ${name}: ${err instanceof Error ? err.message : String(err)}`;
      for (const op of [...this.downloads]) {
        this.settleDownload(op, () => op.reject(new MissionError(message, 'send-failed')));
      }
      for (const op of [...this.uploads]) {
        this.settleUpload(op, () => op.reject(new MissionError(message, 'send-failed')));
      }
      for (const op of [...this.clears]) {
        this.settleClear(op, () => op.reject(new MissionError(message, 'send-failed')));
      }
    };
    try {
      Promise.resolve(this.sendMessage(name, fields)).catch(onError);
    } catch (err) {
      onError(err);
    }
  }

  // --- settle helpers -----------------------------------------------------

  private settleDownload(op: DownloadOp, done: () => void): void {
    if (op.settled) return;
    op.settled = true;
    op.cancelTimer?.();
    op.abortCleanup?.();
    this.downloads.delete(op);
    done();
  }

  private settleUpload(op: UploadOp, done: () => void): void {
    if (op.settled) return;
    op.settled = true;
    op.cancelTimer?.();
    op.abortCleanup?.();
    this.uploads.delete(op);
    done();
  }

  private settleClear(op: ClearOp, done: () => void): void {
    if (op.settled) return;
    op.settled = true;
    op.cancelTimer?.();
    this.clears.delete(op);
    done();
  }
}

/** Construct a {@link MissionClient} (ergonomic factory mirroring sibling services). */
export function createMissionClient(deps: MissionClientDeps): MissionClient {
  return new MissionClient(deps);
}
