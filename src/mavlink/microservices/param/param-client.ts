/**
 * {@link ParamClient} — the classic MAVLink parameter protocol microservice
 * (task T3.2; spec plan/03 §3.4 Parameters, contract {@link ParamClientApi}).
 *
 * Implements the ROBUST primary path over `PARAM_REQUEST_LIST` /
 * `PARAM_REQUEST_READ` / `PARAM_VALUE` / `PARAM_SET`:
 *
 *  - `fetchAll` broadcasts `PARAM_REQUEST_LIST`, collects the streamed
 *    `PARAM_VALUE`s (indexed by `param_index`, total from `param_count`), and —
 *    after a short quiet window with no new values — re-requests each MISSING
 *    index with a targeted `PARAM_REQUEST_READ` until the set is complete or a
 *    bounded number of stalled rounds elapses. Progress is reported as
 *    `(received, total)`.
 *  - `set` emits `PARAM_SET` and awaits the echoed `PARAM_VALUE` to confirm
 *    (retrying on a timer), then updates the cache and fires `onChange`.
 *  - `get` is a pure cached lookup; `onChange` subscribes to value changes.
 *
 * VALUE DECODING follows ArduPilot semantics (primary firmware per spec):
 * `PARAM_VALUE.param_value` IS the numeric value (a float; integer parameters
 * are the value cast to float). PX4's bytewise-reinterpret variant is a known
 * difference documented in ./README.md; it is NOT applied here.
 *
 * Pure logic: the host seam ({@link ParamSendFn} / {@link ParamMessageTap}), the
 * target accessor, and the {@link ParamClock} are all injected, so the client
 * unit-tests against a mock host and a fake clock with no worker.
 */
import type { ParamClient as ParamClientApi, Param } from '../../../contracts';
import type { DecodedMessage, FieldValue } from '../../../contracts';
import { MAV_PARAM_TYPE, PARAM_ID_LEN, PARAM_INDEX_NONE } from './constants';
import { numField as num } from '../fields';

/** Encode + send a message out the active link (bound to host `sendMessage`). */
export type ParamSendFn = (name: string, fields: Record<string, unknown>) => void | Promise<void>;

/** Subscribe a selective decoded-message tap (bound to host `onMessage`). */
export type ParamMessageTap = (
  names: readonly string[],
  cb: (msg: DecodedMessage) => void,
) => () => void;

/** Target (sysid/compid) a parameter request/set is addressed to. */
export interface ParamTarget {
  readonly sysid: number;
  readonly compid: number;
}

/** Returns the currently-active parameter target, or `undefined` when none. */
export type ParamTargetAccessor = () => ParamTarget | undefined;

/**
 * Schedules `handler` after `ms`, returning a cancel function. Abstracted so
 * tests drive the quiet window / retries / timeouts with a deterministic clock.
 */
export interface ParamClock {
  setTimeout(handler: () => void, ms: number): () => void;
}

/** Why a {@link ParamError} occurred — drives caller handling / UI. */
export type ParamErrorReason = 'no-target' | 'aborted' | 'timeout' | 'disposed' | 'send-failed';

/** A failed parameter operation: carries the {@link ParamErrorReason}. */
export class ParamError extends Error {
  constructor(
    message: string,
    readonly reason: ParamErrorReason,
    /** The parameter name, when the failure concerns a single parameter. */
    readonly param?: string,
  ) {
    super(message);
    this.name = 'ParamError';
  }
}

/** Construction dependencies for {@link ParamClient}. */
export interface ParamClientDeps {
  /** Encode + send a message (host `sendMessage`). */
  readonly sendMessage: ParamSendFn;
  /** Subscribe a decoded-message tap (host `onMessage`). */
  readonly onMessage: ParamMessageTap;
  /** Resolve the active parameter target (sysid/compid). */
  readonly getTarget: ParamTargetAccessor;
  /** Timer source (default: global `setTimeout`/`clearTimeout`). */
  readonly clock?: ParamClock;
  /** Quiet window with no new `PARAM_VALUE` before checking for gaps, ms (default 800). */
  readonly fetchQuietMs?: number;
  /** Max consecutive stalled (no-progress) fetch rounds before timeout (default 12). */
  readonly fetchMaxStallRounds?: number;
  /** `PARAM_SET` resend interval while awaiting confirmation, ms (default 1000). */
  readonly setResendMs?: number;
  /** Max `PARAM_SET` send attempts before a timeout rejection (default 5). */
  readonly setMaxAttempts?: number;
  /** Absolute/relative tolerance when confirming a `set` echo (default 1e-4). */
  readonly confirmTolerance?: number;
}

/** Default clock backed by the host environment's timer functions. */
const DEFAULT_CLOCK: ParamClock = {
  setTimeout(handler: () => void, ms: number): () => void {
    const id = setTimeout(handler, ms);
    return () => clearTimeout(id);
  },
};

/** Whether `msg` belongs to `target` for parameter protocol state/cache updates. */
function fromTarget(msg: DecodedMessage, target: ParamTarget): boolean {
  return msg.sysid === target.sysid && msg.compid === target.compid;
}

/** Trim a MAVLink `char[16]` `param_id` to its NUL-terminated string value. */
function trimParamId(s: string): string {
  const clamped = s.length > PARAM_ID_LEN ? s.slice(0, PARAM_ID_LEN) : s;
  const nul = clamped.indexOf('\0');
  return nul >= 0 ? clamped.slice(0, nul) : clamped;
}

/**
 * Decode a `param_id` field into a string. The codec NUL-trims `char[]` to a
 * string, but a raw char-code array is also accepted defensively.
 */
function paramId(fields: Record<string, FieldValue>, key: string): string | undefined {
  const v = fields[key];
  if (typeof v === 'string') return trimParamId(v);
  if (Array.isArray(v)) {
    let s = '';
    for (const code of v) s += String.fromCharCode(Number(code) & 0xff);
    return trimParamId(s);
  }
  return undefined;
}

/** One in-flight `fetchAll` collecting the parameter set. */
interface FetchOp {
  readonly target: ParamTarget;
  readonly received: Map<number, Param>;
  readonly extras: Map<string, Param>;
  total: number | undefined;
  lastCheckedCount: number;
  stallRounds: number;
  settled: boolean;
  cancelTimer?: () => void;
  abortCleanup?: () => void;
  readonly onProgress?: (done: number, total: number) => void;
  readonly resolve: (params: Param[]) => void;
  readonly reject: (err: ParamError) => void;
}

/** One in-flight `set` awaiting its echoed `PARAM_VALUE` confirmation. */
interface SetOp {
  readonly target: ParamTarget;
  readonly name: string;
  readonly value: number;
  readonly type: number;
  attempts: number;
  settled: boolean;
  cancelTimer?: () => void;
  readonly resolve: () => void;
  readonly reject: (err: ParamError) => void;
}

/**
 * Implements the frozen {@link ParamClientApi} on top of an injected host
 * send/tap pair. See the file header and ./README.md for the contract.
 */
export class ParamClient implements ParamClientApi {
  private readonly sendMessage: ParamSendFn;
  private readonly getTarget: ParamTargetAccessor;
  private readonly clock: ParamClock;
  private readonly fetchQuietMs: number;
  private readonly fetchMaxStallRounds: number;
  private readonly setResendMs: number;
  private readonly setMaxAttempts: number;
  private readonly confirmTolerance: number;

  private readonly cache = new Map<string, Param>();
  private readonly changeListeners = new Set<(p: Param) => void>();
  private readonly fetches = new Set<FetchOp>();
  private readonly sets = new Map<string, SetOp>();
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(deps: ParamClientDeps) {
    this.sendMessage = deps.sendMessage;
    this.getTarget = deps.getTarget;
    this.clock = deps.clock ?? DEFAULT_CLOCK;
    this.fetchQuietMs = deps.fetchQuietMs ?? 800;
    this.fetchMaxStallRounds = deps.fetchMaxStallRounds ?? 12;
    this.setResendMs = deps.setResendMs ?? 1000;
    this.setMaxAttempts = deps.setMaxAttempts ?? 5;
    this.confirmTolerance = deps.confirmTolerance ?? 1e-4;
    this.unsubscribe = deps.onMessage(['PARAM_VALUE'], (msg) => this.onParamValue(msg));
  }

  /**
   * Fetch the complete parameter set. Broadcasts `PARAM_REQUEST_LIST`, collects
   * the streamed `PARAM_VALUE`s, and re-requests any missing indices after each
   * quiet window until the set is complete. Resolves the parameters ordered by
   * `param_index`. Rejects on no-target, abort, or a bounded stall timeout.
   */
  fetchAll(
    onProgress?: (done: number, total: number) => void,
    signal?: AbortSignal,
  ): Promise<Param[]> {
    return new Promise<Param[]>((resolve, reject) => {
      if (this.disposed) {
        reject(new ParamError('param client disposed', 'disposed'));
        return;
      }
      const target = this.getTarget();
      if (target === undefined) {
        reject(new ParamError('no active vehicle/target', 'no-target'));
        return;
      }
      if (signal?.aborted === true) {
        reject(new ParamError('fetch aborted', 'aborted'));
        return;
      }
      const op: FetchOp = {
        target,
        received: new Map<number, Param>(),
        extras: new Map<string, Param>(),
        total: undefined,
        lastCheckedCount: 0,
        stallRounds: 0,
        settled: false,
        resolve,
        reject,
        ...(onProgress !== undefined ? { onProgress } : {}),
      };
      if (signal !== undefined) {
        const onAbort = (): void =>
          this.settleFetch(op, () => op.reject(new ParamError('fetch aborted', 'aborted')));
        signal.addEventListener('abort', onAbort, { once: true });
        op.abortCleanup = () => signal.removeEventListener('abort', onAbort);
      }
      this.fetches.add(op);
      this.sendRequestList(op.target);
      op.cancelTimer = this.clock.setTimeout(() => this.onFetchQuiet(op), this.fetchQuietMs);
    });
  }

  /** Cached lookup of a previously-fetched (or changed) parameter. */
  get(name: string): Param | undefined {
    return this.cache.get(name);
  }

  /**
   * Write `value` to parameter `name` via `PARAM_SET` and await the echoed
   * `PARAM_VALUE` to confirm (resending on a timer up to the attempt bound). The
   * wire `param_type` is the cached type, defaulting to `REAL32` for an unknown
   * parameter (ArduPilot ignores it). Updates the cache and fires `onChange` on
   * confirmation. Rejects on no-target or timeout.
   */
  set(name: string, value: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.disposed) {
        reject(new ParamError('param client disposed', 'disposed', name));
        return;
      }
      const target = this.getTarget();
      if (target === undefined) {
        reject(new ParamError('no active vehicle/target', 'no-target', name));
        return;
      }
      const existing = this.sets.get(name);
      if (existing !== undefined) {
        this.settleSet(existing, () =>
          existing.reject(new ParamError(`superseded set of "${name}"`, 'aborted', name)),
        );
      }
      const type = this.cache.get(name)?.type ?? MAV_PARAM_TYPE.REAL32;
      const op: SetOp = {
        target,
        name,
        value,
        type,
        attempts: 1,
        settled: false,
        resolve,
        reject,
      };
      this.sets.set(name, op);
      this.sendParamSet(op);
      // `sendParamSet` may have synchronously failed + settled the op (send-failed).
      if (!op.settled) {
        op.cancelTimer = this.clock.setTimeout(() => this.onSetTick(op), this.setResendMs);
      }
    });
  }

  /** Subscribe to parameter value changes (set echoes + spontaneous updates). */
  onChange(cb: (p: Param) => void): () => void {
    this.changeListeners.add(cb);
    return () => {
      this.changeListeners.delete(cb);
    };
  }

  /**
   * Tear down: unsubscribe the `PARAM_VALUE` tap and reject any in-flight fetch
   * / set operations. Not part of the frozen interface; call when discarding.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const op of [...this.fetches]) {
      this.settleFetch(op, () => op.reject(new ParamError('param client disposed', 'disposed')));
    }
    for (const op of [...this.sets.values()]) {
      this.settleSet(op, () =>
        op.reject(new ParamError('param client disposed', 'disposed', op.name)),
      );
    }
    this.changeListeners.clear();
  }

  // --- internals ----------------------------------------------------------

  /** Broadcast `PARAM_REQUEST_LIST` to `target`. */
  private sendRequestList(target: ParamTarget): void {
    this.emit('PARAM_REQUEST_LIST', {
      target_system: target.sysid,
      target_component: target.compid,
    });
  }

  /** Request a single parameter by `index` via `PARAM_REQUEST_READ`. */
  private sendRequestRead(target: ParamTarget, index: number): void {
    if (index > 0x7fff) return;
    this.emit('PARAM_REQUEST_READ', {
      target_system: target.sysid,
      target_component: target.compid,
      param_id: '',
      param_index: index,
    });
  }

  /** Emit a `PARAM_SET` for `op`. */
  private sendParamSet(op: SetOp): void {
    this.emit('PARAM_SET', {
      target_system: op.target.sysid,
      target_component: op.target.compid,
      param_id: op.name,
      param_value: op.value,
      param_type: op.type,
    });
  }

  /** Fire-and-forget send; surfaces a send failure (sync or async) to a set. */
  private emit(name: string, fields: Record<string, unknown>): void {
    const onError = (err: unknown): void => {
      // Only a set has a caller awaiting an immediate failure; fetches rely on
      // the retry/timeout path. Reject any set whose PARAM_SET failed to send.
      if (name !== 'PARAM_SET' || typeof fields.param_id !== 'string') return;
      const op = this.sets.get(fields.param_id);
      if (op === undefined) return;
      this.settleSet(op, () =>
        op.reject(
          new ParamError(
            `failed to send PARAM_SET "${op.name}": ${err instanceof Error ? err.message : String(err)}`,
            'send-failed',
            op.name,
          ),
        ),
      );
    };
    try {
      Promise.resolve(this.sendMessage(name, fields)).catch(onError);
    } catch (err) {
      onError(err);
    }
  }

  /** Handle an incoming `PARAM_VALUE`: cache, feed fetches, confirm sets, notify. */
  private onParamValue(msg: DecodedMessage): void {
    const name = paramId(msg.fields, 'param_id');
    const value = num(msg.fields, 'param_value');
    if (name === undefined || name.length === 0 || value === undefined) return;
    const type =
      num(msg.fields, 'param_type') ?? this.cache.get(name)?.type ?? MAV_PARAM_TYPE.REAL32;
    const index = num(msg.fields, 'param_index');
    const count = num(msg.fields, 'param_count');

    const param: Param = { name, value, type };
    const matchingFetches = [...this.fetches].filter((op) => fromTarget(msg, op.target));
    const activeTargets = [
      ...[...this.fetches].map((op) => op.target),
      ...[...this.sets.values()].map((op) => op.target),
    ];
    const pending = this.sets.get(name);
    const pendingSet =
      pending !== undefined && fromTarget(msg, pending.target) ? pending : undefined;
    const currentTarget = this.getTarget();
    const matchesAllowedTarget =
      activeTargets.length > 0
        ? activeTargets.some((target) => fromTarget(msg, target))
        : currentTarget !== undefined && fromTarget(msg, currentTarget);
    if (matchingFetches.length === 0 && pendingSet === undefined && !matchesAllowedTarget) return;

    const prev = this.cache.get(name);
    this.cache.set(name, param);

    // Snapshot BEFORE recording: a value that completes a fetch removes that
    // fetch mid-handler, so we must not then treat it as a spontaneous change.
    const consumedByFetch = matchingFetches.length > 0;
    for (const op of matchingFetches) this.recordFetch(op, param, index, count);

    if (pendingSet !== undefined && this.valuesMatch(pendingSet.value, value)) {
      this.settleSet(pendingSet, () => {
        pendingSet.resolve();
        this.emitChange(param);
      });
      return;
    }

    // Spontaneous (non-fetch, non-set-echo) add/change → notify subscribers.
    if (!consumedByFetch && (prev === undefined || prev.value !== value || prev.type !== type)) {
      this.emitChange(param);
    }
  }

  /** Record a `PARAM_VALUE` against an in-flight fetch; resolve when complete. */
  private recordFetch(
    op: FetchOp,
    param: Param,
    index: number | undefined,
    count: number | undefined,
  ): void {
    if (op.settled) return;
    if (count !== undefined && count > 0 && op.total === undefined) op.total = count;
    if (index !== undefined && index >= 0 && index !== PARAM_INDEX_NONE) {
      op.received.set(index, param);
    } else {
      op.extras.set(param.name, param);
    }
    // Fresh value → push the quiet-window check out so we wait for the burst.
    op.cancelTimer?.();
    op.cancelTimer = this.clock.setTimeout(() => this.onFetchQuiet(op), this.fetchQuietMs);

    this.reportProgress(op);
    if (op.total !== undefined && op.received.size >= op.total) {
      this.settleFetch(op, () => op.resolve(this.buildResult(op)));
    }
  }

  /** Quiet window elapsed: complete, re-request gaps, or time out on a stall. */
  private onFetchQuiet(op: FetchOp): void {
    if (op.settled) return;
    const count = op.received.size;

    if (op.total !== undefined && count >= op.total) {
      this.settleFetch(op, () => op.resolve(this.buildResult(op)));
      return;
    }

    const progressed = count > op.lastCheckedCount;
    op.lastCheckedCount = count;
    op.stallRounds = progressed ? 0 : op.stallRounds + 1;
    if (op.stallRounds > this.fetchMaxStallRounds) {
      this.settleFetch(op, () =>
        op.reject(
          new ParamError(
            `parameter fetch stalled at ${count}/${op.total ?? '?'} after ${op.stallRounds} rounds`,
            'timeout',
          ),
        ),
      );
      return;
    }

    if (op.total === undefined) {
      // No values yet — re-broadcast the list request.
      this.sendRequestList(op.target);
    } else {
      for (let i = 0; i < op.total; i++) {
        if (!op.received.has(i)) this.sendRequestRead(op.target, i);
      }
    }
    op.cancelTimer = this.clock.setTimeout(() => this.onFetchQuiet(op), this.fetchQuietMs);
  }

  /** Emit the current `(received, total)` progress for `op`. */
  private reportProgress(op: FetchOp): void {
    if (op.onProgress === undefined) return;
    const done = op.received.size;
    op.onProgress(done, op.total ?? done);
  }

  /** Assemble the resolved `Param[]`, ordered by index then any extras. */
  private buildResult(op: FetchOp): Param[] {
    const out: Param[] = [];
    const indices = [...op.received.keys()].sort((a, b) => a - b);
    for (const i of indices) {
      const p = op.received.get(i);
      if (p !== undefined) out.push(p);
    }
    for (const p of op.extras.values()) {
      if (!out.some((q) => q.name === p.name)) out.push(p);
    }
    return out;
  }

  /** Retry/timeout tick for a pending `set`: resend or reject on exhaustion. */
  private onSetTick(op: SetOp): void {
    if (op.settled) return;
    if (op.attempts >= this.setMaxAttempts) {
      this.settleSet(op, () =>
        op.reject(
          new ParamError(
            `set "${op.name}" timed out after ${op.attempts} attempts`,
            'timeout',
            op.name,
          ),
        ),
      );
      return;
    }
    op.attempts += 1;
    this.sendParamSet(op);
    if (!op.settled) {
      op.cancelTimer = this.clock.setTimeout(() => this.onSetTick(op), this.setResendMs);
    }
  }

  /** Whether an echoed `value` confirms an expected set `target` value. */
  private valuesMatch(expected: number, actual: number): boolean {
    const tol = Math.max(this.confirmTolerance, Math.abs(expected) * this.confirmTolerance);
    return Math.abs(expected - actual) <= tol;
  }

  /** Finalize a fetch exactly once: cancel the timer, detach, run `done`. */
  private settleFetch(op: FetchOp, done: () => void): void {
    if (op.settled) return;
    op.settled = true;
    op.cancelTimer?.();
    op.abortCleanup?.();
    this.fetches.delete(op);
    done();
  }

  /** Finalize a set exactly once: cancel the timer, detach, run `done`. */
  private settleSet(op: SetOp, done: () => void): void {
    if (op.settled) return;
    op.settled = true;
    op.cancelTimer?.();
    if (this.sets.get(op.name) === op) this.sets.delete(op.name);
    done();
  }

  /** Notify all `onChange` subscribers of a parameter `param`. */
  private emitChange(param: Param): void {
    for (const cb of this.changeListeners) cb(param);
  }
}

/** Construct a {@link ParamClient} (ergonomic factory mirroring sibling services). */
export function createParamClient(deps: ParamClientDeps): ParamClient {
  return new ParamClient(deps);
}
