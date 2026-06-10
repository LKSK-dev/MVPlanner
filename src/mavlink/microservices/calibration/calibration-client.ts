/**
 * {@link CalibrationClient} — MAVLink setup calibration flows (task T5.1; spec
 * plan/03 §3.4 Calibration, contract {@link CalibrationClientApi}).
 *
 * The client is pure orchestration over injected seams:
 *  - `command.send(...)` emits `MAV_CMD_*` commands and awaits COMMAND_ACK.
 *  - `onMessage(...)` taps unthrottled `STATUSTEXT`, `MAG_CAL_*`, and
 *    `RC_CHANNELS` messages from the host.
 *  - `getTarget()` selects/filter messages from the active vehicle.
 *
 * UI-facing user gates stay outside this microservice: accel uses `step(face)`
 * to confirm each vehicle pose, compass progress is reported from
 * `MAG_CAL_PROGRESS`, and radio simply forwards raw RC inputs until the caller
 * aborts capture.
 */
import type {
  CalibrationClient as CalibrationClientApi,
  CommandClient,
  DecodedMessage,
  FieldValue,
} from '../../../contracts';
import { numField as num } from '../fields';
import {
  ACCEL_FACES,
  CMD_ACCELCAL_VEHICLE_POS,
  CMD_DO_CANCEL_MAG_CAL,
  CMD_DO_START_MAG_CAL,
  CMD_PREFLIGHT_CALIBRATION,
  MAG_CAL_STATUS,
} from './constants';

/** Subscribe a selective decoded-message tap (bound to host `onMessage`). */
export type CalibrationMessageTap = (
  names: readonly string[],
  cb: (msg: DecodedMessage) => void,
) => () => void;

/** Target (sysid/compid) the active calibration operation is addressed to. */
export interface CalibrationTarget {
  readonly sysid: number;
  readonly compid: number;
}

/** Returns the currently-active calibration target, or `undefined` when none. */
export type CalibrationTargetAccessor = () => CalibrationTarget | undefined;

/** Timer source for bounded report waits; tests provide a deterministic clock. */
export interface CalibrationClock {
  setTimeout(handler: () => void, ms: number): () => void;
}

/** Why a {@link CalibrationError} occurred — drives caller handling / UI. */
export type CalibrationErrorReason = 'no-target' | 'aborted' | 'timeout' | 'failed' | 'disposed';

/** A failed calibration operation. */
export class CalibrationError extends Error {
  constructor(
    message: string,
    readonly reason: CalibrationErrorReason,
  ) {
    super(message);
    this.name = 'CalibrationError';
  }
}

/** Construction dependencies for {@link CalibrationClient}. */
export interface CalibrationClientDeps {
  /** ACK-bound command microservice used for all `MAV_CMD_*` sends. */
  readonly command: Pick<CommandClient, 'send'>;
  /** Subscribe a decoded-message tap (host `onMessage`). */
  readonly onMessage: CalibrationMessageTap;
  /** Resolve the active calibration target (sysid/compid). */
  readonly getTarget: CalibrationTargetAccessor;
  /** Timer source (default: global `setTimeout`/`clearTimeout`). */
  readonly clock?: CalibrationClock;
  /** Max time to wait for a vehicle report after starting onboard mag cal. */
  readonly compassTimeoutMs?: number;
}

/** Default clock backed by the host environment's timer functions. */
const DEFAULT_CLOCK: CalibrationClock = {
  setTimeout(handler: () => void, ms: number): () => void {
    const id = setTimeout(handler, ms);
    return () => clearTimeout(id);
  },
};

const DEFAULT_COMPASS_TIMEOUT_MS = 120_000;
const PREFLIGHT_GYRO_PARAMS = [1, 0, 0, 0, 0, 0, 0] as const;
const PREFLIGHT_LEVEL_PARAMS = [0, 0, 0, 0, 2, 0, 0] as const;
const PREFLIGHT_ACCEL_PARAMS = [0, 0, 0, 0, 1, 0, 0] as const;
const START_MAG_PARAMS = [0, 0, 1, 0, 0, 0, 0] as const;
const CANCEL_MAG_PARAMS = [0, 0, 0, 0, 0, 0, 0] as const;

/** Decode `STATUSTEXT.text` from string or char-code array forms. */
function text(fields: Record<string, FieldValue>, key: string): string | undefined {
  const v = fields[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    let s = '';
    for (const code of v) {
      if (code === 0) break;
      s += String.fromCharCode(Number(code) & 0xff);
    }
    return s;
  }
  return undefined;
}

/** Pass an optional signal to `CommandClient.send` without assigning `undefined`. */
function sendOpts(signal: AbortSignal | undefined): { signal: AbortSignal } | undefined {
  return signal !== undefined ? { signal } : undefined;
}

/** Whether `msg` belongs to the selected vehicle. */
function fromTarget(msg: DecodedMessage, target: CalibrationTarget): boolean {
  return msg.sysid === target.sysid;
}

/** Heuristic failure detector for ArduPilot accel calibration `STATUSTEXT`s. */
function accelFailureStatus(s: string): boolean {
  const lower = s.toLowerCase();
  return (
    lower.includes('accel') &&
    (lower.includes('fail') || lower.includes('failed') || lower.includes('abort'))
  );
}

/** Terminal MAG_CAL statuses that mean failure/rejection. */
function magFailure(status: number): boolean {
  return (
    status === MAG_CAL_STATUS.FAILED ||
    status === MAG_CAL_STATUS.BAD_ORIENTATION ||
    status === MAG_CAL_STATUS.BAD_RADIUS
  );
}

/** Extract RC_CHANNELS raw values in chan1..chanN order. */
function rcChannels(fields: Record<string, FieldValue>): number[] {
  const count = Math.max(0, Math.min(18, Math.trunc(num(fields, 'chancount') ?? 18)));
  const channels: number[] = [];
  for (let i = 1; i <= count; i++) {
    const value = num(fields, `chan${i}_raw`);
    if (value === undefined) break;
    channels.push(value);
  }
  return channels;
}

/** In-flight radio capture state; disposed clients settle and unsubscribe these taps. */
interface RadioOp {
  settled: boolean;
  unsubscribe?: () => void;
  abortCleanup?: () => void;
  readonly resolve: () => void;
  readonly reject: (err: CalibrationError) => void;
}

/** A one-shot externally rejectable guard used to race abort/failure with awaits. */
function makeRejectGuard(): {
  readonly promise: Promise<never>;
  readonly reject: (err: CalibrationError) => void;
} {
  let rejectFn: (err: CalibrationError) => void = () => undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    rejectFn = reject;
  });
  return { promise, reject: rejectFn };
}

/**
 * Implements the frozen {@link CalibrationClientApi}. See the file header and
 * ./README.md for command ids, message ids, and known firmware differences.
 */
export class CalibrationClient implements CalibrationClientApi {
  private readonly command: Pick<CommandClient, 'send'>;
  private readonly onMessageTap: CalibrationMessageTap;
  private readonly getTarget: CalibrationTargetAccessor;
  private readonly clock: CalibrationClock;
  private readonly compassTimeoutMs: number;
  private readonly radioOps = new Set<RadioOp>();
  private disposed = false;

  constructor(deps: CalibrationClientDeps) {
    this.command = deps.command;
    this.onMessageTap = deps.onMessage;
    this.getTarget = deps.getTarget;
    this.clock = deps.clock ?? DEFAULT_CLOCK;
    this.compassTimeoutMs = deps.compassTimeoutMs ?? DEFAULT_COMPASS_TIMEOUT_MS;
  }

  /**
   * Run ArduPilot's full 6-point accelerometer calibration. `step(face)` is the
   * UI/user gate for each face in order: LEVEL, LEFT, RIGHT, NOSEDOWN, NOSEUP,
   * BACK. `STATUSTEXT` is observed for failure/abort diagnostics.
   */
  async accel6Point(step: (face: string) => Promise<void>, signal?: AbortSignal): Promise<void> {
    this.throwIfDisposed();
    const target = this.requireTarget();
    const guard = makeRejectGuard();
    const fail = (err: CalibrationError): void => guard.reject(err);
    const onAbort = (): void =>
      fail(new CalibrationError('accelerometer calibration aborted', 'aborted'));
    if (signal?.aborted === true) onAbort();
    signal?.addEventListener('abort', onAbort, { once: true });
    const unsubscribe = this.onMessageTap(['STATUSTEXT'], (msg) => {
      if (!fromTarget(msg, target)) return;
      const status = text(msg.fields, 'text');
      if (status !== undefined && accelFailureStatus(status)) {
        fail(new CalibrationError(`accelerometer calibration failed: ${status}`, 'failed'));
      }
    });

    try {
      await this.raceGuard(
        this.command.send(CMD_PREFLIGHT_CALIBRATION, [...PREFLIGHT_ACCEL_PARAMS], sendOpts(signal)),
        guard.promise,
      );
      for (const face of ACCEL_FACES) {
        await this.raceGuard(step(face.name), guard.promise);
        await this.raceGuard(
          this.command.send(
            CMD_ACCELCAL_VEHICLE_POS,
            [face.value, 0, 0, 0, 0, 0, 0],
            sendOpts(signal),
          ),
          guard.promise,
        );
      }
    } finally {
      unsubscribe();
      signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Run accelerometer level calibration (`MAV_CMD_PREFLIGHT_CALIBRATION`, p5=2). */
  async level(signal?: AbortSignal): Promise<void> {
    this.throwIfDisposed();
    await this.command.send(
      CMD_PREFLIGHT_CALIBRATION,
      [...PREFLIGHT_LEVEL_PARAMS],
      sendOpts(signal),
    );
  }

  /**
   * Run onboard compass calibration. Progress is emitted from
   * `MAG_CAL_PROGRESS.completion_pct`; success resolves offsets from
   * `MAG_CAL_REPORT.ofs_x/y/z`. Aborting sends `MAV_CMD_DO_CANCEL_MAG_CAL`.
   */
  async compass(
    onProgress: (pct: number, fitness?: number) => void,
    signal?: AbortSignal,
  ): Promise<{ offsets: number[] }> {
    this.throwIfDisposed();
    const target = this.requireTarget();
    return new Promise<{ offsets: number[] }>((resolve, reject) => {
      let settled = false;
      const cleanup: { cancelTimer?: () => void; unsubscribe?: () => void } = {};

      const settle = (done: () => void): void => {
        if (settled) return;
        settled = true;
        cleanup.cancelTimer?.();
        cleanup.unsubscribe?.();
        signal?.removeEventListener('abort', onAbort);
        done();
      };
      const rejectWith = (err: CalibrationError): void => settle(() => reject(err));
      const cancelMag = (): void => {
        void this.command.send(CMD_DO_CANCEL_MAG_CAL, [...CANCEL_MAG_PARAMS]).catch(() => {
          /* best-effort cancel; preserve the original abort outcome */
        });
      };
      const onAbort = (): void => {
        cancelMag();
        rejectWith(new CalibrationError('compass calibration aborted', 'aborted'));
      };

      if (signal?.aborted === true) {
        onAbort();
        return;
      }
      signal?.addEventListener('abort', onAbort, { once: true });
      cleanup.unsubscribe = this.onMessageTap(['MAG_CAL_PROGRESS', 'MAG_CAL_REPORT'], (msg) => {
        if (!fromTarget(msg, target)) return;
        if (msg.name === 'MAG_CAL_PROGRESS') {
          const pct = num(msg.fields, 'completion_pct');
          if (pct !== undefined) onProgress(pct);
          const status = num(msg.fields, 'cal_status');
          if (status !== undefined && magFailure(status)) {
            rejectWith(
              new CalibrationError(`compass calibration failed: status ${status}`, 'failed'),
            );
          }
          return;
        }
        if (msg.name !== 'MAG_CAL_REPORT') return;
        const status = num(msg.fields, 'cal_status');
        if (status === MAG_CAL_STATUS.SUCCESS) {
          const ofsX = num(msg.fields, 'ofs_x') ?? 0;
          const ofsY = num(msg.fields, 'ofs_y') ?? 0;
          const ofsZ = num(msg.fields, 'ofs_z') ?? 0;
          settle(() => resolve({ offsets: [ofsX, ofsY, ofsZ] }));
          return;
        }
        if (status !== undefined && magFailure(status)) {
          rejectWith(
            new CalibrationError(`compass calibration failed: status ${status}`, 'failed'),
          );
        }
      });
      cleanup.cancelTimer = this.clock.setTimeout(() => {
        // Best-effort: stop the onboard calibration before giving up locally.
        cancelMag();
        rejectWith(new CalibrationError('compass calibration timed out', 'timeout'));
      }, this.compassTimeoutMs);

      void this.command
        .send(CMD_DO_START_MAG_CAL, [...START_MAG_PARAMS], sendOpts(signal))
        .catch((err: unknown) => {
          rejectWith(
            err instanceof CalibrationError ? err : new CalibrationError(String(err), 'failed'),
          );
        });
    });
  }

  /** Run gyro calibration (`MAV_CMD_PREFLIGHT_CALIBRATION`, p1=1). */
  async gyro(signal?: AbortSignal): Promise<void> {
    this.throwIfDisposed();
    await this.command.send(
      CMD_PREFLIGHT_CALIBRATION,
      [...PREFLIGHT_GYRO_PARAMS],
      sendOpts(signal),
    );
  }

  /**
   * Forward `RC_CHANNELS.chan*_raw` values until the caller aborts capture. The
   * UI owns min/max/radio-parameter persistence; this service only streams raw
   * channel values and resolves on abort.
   */
  radio(onChannels: (ch: number[]) => void, signal?: AbortSignal): Promise<void> {
    this.throwIfDisposed();
    const target = this.requireTarget();
    return new Promise<void>((resolve, reject) => {
      const op: RadioOp = { settled: false, resolve, reject };
      const settle = (done: () => void): void => {
        if (op.settled) return;
        op.settled = true;
        op.unsubscribe?.();
        op.abortCleanup?.();
        this.radioOps.delete(op);
        done();
      };
      if (signal?.aborted === true) {
        resolve();
        return;
      }
      if (signal !== undefined) {
        const onAbort = (): void => settle(() => resolve());
        signal.addEventListener('abort', onAbort, { once: true });
        op.abortCleanup = () => signal.removeEventListener('abort', onAbort);
      }
      op.unsubscribe = this.onMessageTap(['RC_CHANNELS'], (msg) => {
        if (!fromTarget(msg, target)) return;
        const channels = rcChannels(msg.fields);
        if (channels.length > 0) onChannels(channels);
      });
      this.radioOps.add(op);
    });
  }

  /** Tear down this client and reject any in-flight radio capture. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const op of [...this.radioOps]) {
      this.settleRadio(op, () =>
        op.reject(new CalibrationError('calibration client disposed', 'disposed')),
      );
    }
  }

  private throwIfDisposed(): void {
    if (this.disposed) throw new CalibrationError('calibration client disposed', 'disposed');
  }

  private requireTarget(): CalibrationTarget {
    const target = this.getTarget();
    if (target === undefined)
      throw new CalibrationError('no active calibration target', 'no-target');
    return target;
  }

  private settleRadio(op: RadioOp, done: () => void): void {
    if (op.settled) return;
    op.settled = true;
    op.unsubscribe?.();
    op.abortCleanup?.();
    this.radioOps.delete(op);
    done();
  }

  private async raceGuard<T>(p: Promise<T>, guard: Promise<never>): Promise<T> {
    return Promise.race([p, guard]);
  }
}

/** Construct a {@link CalibrationClient}. */
export function createCalibrationClient(deps: CalibrationClientDeps): CalibrationClient {
  return new CalibrationClient(deps);
}
