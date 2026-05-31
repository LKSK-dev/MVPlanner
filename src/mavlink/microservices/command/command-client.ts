/**
 * {@link CommandClient} — the COMMAND_LONG/COMMAND_INT ↔ COMMAND_ACK microservice
 * plus the mode/arm and guided helpers (tasks T2.5 + T2.6; spec plan/03 §3.4
 * "Command" and "Mode/Arm", contract {@link CommandClientApi}).
 *
 * Design (see ./README.md for the full contract):
 *  - `send(cmd, params, opts)` emits a COMMAND_LONG (or COMMAND_INT when
 *    `opts.int`) to the ACTIVE vehicle and correlates the COMMAND_ACK (msg 77)
 *    for that command id arriving FROM that vehicle. It retries-until-ack with a
 *    bounded number of attempts (resending on a fixed interval, incrementing the
 *    COMMAND_LONG `confirmation` count) and rejects on timeout.
 *  - `MAV_RESULT_IN_PROGRESS` keeps the operation pending and records the latest
 *    progress %, extending the deadline until a terminal ACK arrives.
 *  - terminal `DENIED` / `FAILED` / `UNSUPPORTED` (and the `*_ONLY` variants)
 *    reject with a typed {@link CommandError}; `ACCEPTED` resolves.
 *  - an {@link AbortSignal} cancels a pending command immediately.
 *
 * Pure logic: the host seam ({@link CommandSendFn} / {@link CommandMessageTap}),
 * the active-vehicle accessor, and the {@link CommandClock} are all injected, so
 * the client unit-tests against a mock host and a fake clock with no worker.
 */
import type { CommandClient as CommandClientApi } from '../../../contracts';
import type { DecodedMessage, FieldValue, VehicleClass } from '../../../contracts';
import { arduMapForClass } from '../../../vehicle';
import {
  ARM_FORCE_MAGIC,
  CMD_COMPONENT_ARM_DISARM,
  CMD_DO_SET_MODE,
  CMD_DO_SET_ROI_LOCATION,
  CMD_DO_SET_ROI_NONE,
  CMD_NAV_LAND,
  CMD_NAV_TAKEOFF,
  LATLON_SCALE,
  MAV_FRAME_GLOBAL,
  MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
  MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
  MAV_RESULT,
  POSITION_ONLY_TYPE_MASK,
  resultName,
} from './constants';

/** Encode + send a message out the active link (bound to host `sendMessage`). */
export type CommandSendFn = (name: string, fields: Record<string, unknown>) => void | Promise<void>;

/** Subscribe a selective decoded-message tap (bound to host `onMessage`). */
export type CommandMessageTap = (
  names: readonly string[],
  cb: (msg: DecodedMessage) => void,
) => () => void;

/** Minimal active-vehicle reference the client needs (a {@link VehicleState} fits). */
export interface ActiveVehicle {
  readonly sysid: number;
  readonly compid: number;
  readonly vehicleClass: VehicleClass;
}

/** Returns the currently-active vehicle, or `undefined` when none is selected. */
export type ActiveVehicleAccessor = () => ActiveVehicle | undefined;

/**
 * Schedules `handler` after `ms`, returning a cancel function. Abstracted so
 * tests drive retries/timeouts with a deterministic fake clock.
 */
export interface CommandClock {
  setTimeout(handler: () => void, ms: number): () => void;
}

/** Why a {@link CommandError} occurred — drives caller handling / UI. */
export type CommandErrorReason = 'no-vehicle' | 'aborted' | 'timeout' | 'rejected' | 'send-failed';

/** A failed command: carries the {@link CommandErrorReason} and `MAV_RESULT`. */
export class CommandError extends Error {
  constructor(
    message: string,
    readonly reason: CommandErrorReason,
    readonly command: number,
    readonly result?: number,
  ) {
    super(message);
    this.name = 'CommandError';
  }
}

/** Construction dependencies for {@link CommandClient}. */
export interface CommandClientDeps {
  /** Encode + send a message (host `sendMessage`). */
  readonly sendMessage: CommandSendFn;
  /** Subscribe a decoded-message tap (host `onMessage`). */
  readonly onMessage: CommandMessageTap;
  /** Resolve the active vehicle (sysid/compid + class). */
  readonly getActiveVehicle: ActiveVehicleAccessor;
  /** Timer source (default: global `setTimeout`/`clearTimeout`). */
  readonly clock?: CommandClock;
  /** Max send attempts before a timeout rejection (default 5). */
  readonly maxAttempts?: number;
  /** Resend interval while awaiting the first ACK, ms (default 1000). */
  readonly resendMs?: number;
  /** Deadline extension granted on each IN_PROGRESS ACK, ms (default 5000). */
  readonly progressTimeoutMs?: number;
}

/** Options accepted by {@link CommandClient.send}. */
export interface CommandSendOpts {
  int?: boolean;
  frame?: number;
  confirm?: number;
  signal?: AbortSignal;
}

/** The settled value of {@link CommandClient.send}. */
export interface CommandResult {
  result: number;
  progressPct?: number;
}

/** Read a scalar field as a number (coercing bigint); `undefined` otherwise. */
function num(fields: Record<string, FieldValue>, key: string): number | undefined {
  const v = fields[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') return Number(v);
  return undefined;
}

/** Pad/truncate a param array to the 7 COMMAND_LONG/INT slots. */
function params7(
  params: readonly number[],
): [number, number, number, number, number, number, number] {
  return [
    params[0] ?? 0,
    params[1] ?? 0,
    params[2] ?? 0,
    params[3] ?? 0,
    params[4] ?? 0,
    params[5] ?? 0,
    params[6] ?? 0,
  ];
}

/** Default clock backed by the host environment's timer functions. */
const DEFAULT_CLOCK: CommandClock = {
  setTimeout(handler: () => void, ms: number): () => void {
    const id = setTimeout(handler, ms);
    return () => clearTimeout(id);
  },
};

/** One in-flight command awaiting (or progressing toward) its terminal ACK. */
interface Pending {
  readonly cmd: number;
  readonly sysid: number;
  readonly compid: number;
  readonly int: boolean;
  readonly frame: number;
  readonly params: [number, number, number, number, number, number, number];
  confirm: number;
  attempts: number;
  inProgress: boolean;
  settled: boolean;
  progressPct?: number;
  cancelTimer?: () => void;
  abortCleanup?: () => void;
  readonly resolve: (r: CommandResult) => void;
  readonly reject: (e: CommandError) => void;
}

/**
 * Implements the frozen {@link CommandClientApi} on top of an injected host
 * send/tap pair. See the file header and ./README.md for the contract.
 */
export class CommandClient implements CommandClientApi {
  private readonly sendMessage: CommandSendFn;
  private readonly getActiveVehicle: ActiveVehicleAccessor;
  private readonly clock: CommandClock;
  private readonly maxAttempts: number;
  private readonly resendMs: number;
  private readonly progressTimeoutMs: number;
  private readonly pending: Pending[] = [];
  private readonly unsubscribe: () => void;
  private disposed = false;

  constructor(deps: CommandClientDeps) {
    this.sendMessage = deps.sendMessage;
    this.getActiveVehicle = deps.getActiveVehicle;
    this.clock = deps.clock ?? DEFAULT_CLOCK;
    this.maxAttempts = deps.maxAttempts ?? 5;
    this.resendMs = deps.resendMs ?? 1000;
    this.progressTimeoutMs = deps.progressTimeoutMs ?? 5000;
    this.unsubscribe = deps.onMessage(['COMMAND_ACK'], (msg) => this.onAck(msg));
  }

  /**
   * Send `cmd` with up to 7 `params` to the active vehicle and resolve with its
   * `MAV_RESULT`. For `opts.int`, `params[4]`/`params[5]` are the pre-scaled
   * `x`/`y` integer fields and `params[6]` is `z`. Retries until ACK or timeout;
   * an `opts.signal` abort cancels immediately.
   */
  send(cmd: number, params: number[], opts: CommandSendOpts = {}): Promise<CommandResult> {
    return new Promise<CommandResult>((resolve, reject) => {
      if (this.disposed) {
        reject(new CommandError('command client disposed', 'aborted', cmd));
        return;
      }
      const vehicle = this.getActiveVehicle();
      if (vehicle === undefined) {
        reject(new CommandError('no active vehicle', 'no-vehicle', cmd));
        return;
      }
      const signal = opts.signal;
      if (signal?.aborted === true) {
        reject(new CommandError('command aborted', 'aborted', cmd));
        return;
      }
      const p: Pending = {
        cmd,
        sysid: vehicle.sysid,
        compid: vehicle.compid,
        int: opts.int ?? false,
        frame: opts.frame ?? MAV_FRAME_GLOBAL,
        params: params7(params),
        confirm: opts.confirm ?? 0,
        attempts: 1,
        inProgress: false,
        settled: false,
        resolve,
        reject,
      };
      if (signal !== undefined) {
        const onAbort = (): void =>
          this.settle(p, () => p.reject(new CommandError('command aborted', 'aborted', cmd)));
        signal.addEventListener('abort', onAbort, { once: true });
        p.abortCleanup = () => signal.removeEventListener('abort', onAbort);
      }
      this.pending.push(p);
      this.transmit(p);
      p.cancelTimer = this.clock.setTimeout(() => this.tick(p), this.resendMs);
    });
  }

  /** Arm (`true`) / disarm (`false`); `force` bypasses pre-arm checks (param2=21196). */
  async arm(arm: boolean, force = false): Promise<void> {
    await this.send(CMD_COMPONENT_ARM_DISARM, [arm ? 1 : 0, force ? ARM_FORCE_MAGIC : 0]);
  }

  /**
   * Set the flight mode by name for the active vehicle's class. Primary path is
   * `MAV_CMD_DO_SET_MODE` with the resolved `custom_mode`; on an `UNSUPPORTED`
   * rejection it falls back to the legacy `SET_MODE` message (no ACK).
   */
  async setMode(mode: string): Promise<void> {
    const vehicle = this.requireVehicle(CMD_DO_SET_MODE);
    const customMode = this.resolveCustomMode(vehicle.vehicleClass, mode);
    try {
      await this.send(CMD_DO_SET_MODE, [MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, customMode]);
    } catch (err) {
      if (err instanceof CommandError && err.result === MAV_RESULT.UNSUPPORTED) {
        await Promise.resolve(
          this.sendMessage('SET_MODE', {
            target_system: vehicle.sysid,
            base_mode: MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            custom_mode: customMode,
          }),
        );
        return;
      }
      throw err;
    }
  }

  /** Take off to `altM` (relative altitude) via `MAV_CMD_NAV_TAKEOFF` param7. */
  async takeoff(altM: number): Promise<void> {
    await this.send(CMD_NAV_TAKEOFF, [0, 0, 0, 0, 0, 0, altM]);
  }

  /**
   * Land: copters/subs use their `LAND`/`SURFACE`-style `LAND` mode; other
   * classes issue `MAV_CMD_NAV_LAND` (land in place, lat/lon/alt = 0).
   */
  async land(): Promise<void> {
    const vehicle = this.requireVehicle(CMD_NAV_LAND);
    if (vehicle.vehicleClass === 'copter') {
      await this.setMode('LAND');
      return;
    }
    await this.send(CMD_NAV_LAND, [0, 0, 0, 0, 0, 0, 0]);
  }

  /** Return-to-launch via the vehicle's `RTL` mode. */
  async rtl(): Promise<void> {
    await this.setMode('RTL');
  }

  /**
   * Guided "fly here": stream a `SET_POSITION_TARGET_GLOBAL_INT` position-only
   * setpoint (lat/lon scaled 1e7, alt relative to home). The vehicle must
   * already be in a guided mode; this message is fire-and-forget (no ACK).
   */
  async guidedGoto(lat: number, lon: number, altM: number): Promise<void> {
    const vehicle = this.requireVehicle(0);
    await Promise.resolve(
      this.sendMessage('SET_POSITION_TARGET_GLOBAL_INT', {
        time_boot_ms: 0,
        target_system: vehicle.sysid,
        target_component: vehicle.compid,
        coordinate_frame: MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
        type_mask: POSITION_ONLY_TYPE_MASK,
        lat_int: Math.round(lat * LATLON_SCALE),
        lon_int: Math.round(lon * LATLON_SCALE),
        alt: altM,
        vx: 0,
        vy: 0,
        vz: 0,
        afx: 0,
        afy: 0,
        afz: 0,
        yaw: 0,
        yaw_rate: 0,
      }),
    );
  }

  /** Point at a location via `MAV_CMD_DO_SET_ROI_LOCATION` (COMMAND_INT, GLOBAL). */
  async setRoi(lat: number, lon: number, altM: number): Promise<void> {
    await this.send(
      CMD_DO_SET_ROI_LOCATION,
      [0, 0, 0, 0, Math.round(lat * LATLON_SCALE), Math.round(lon * LATLON_SCALE), altM],
      { int: true, frame: MAV_FRAME_GLOBAL },
    );
  }

  /** Cancel any active region of interest via `MAV_CMD_DO_SET_ROI_NONE`. */
  async clearRoi(): Promise<void> {
    await this.send(CMD_DO_SET_ROI_NONE, [0, 0, 0, 0, 0, 0, 0]);
  }

  /** Jump the active mission to `seq` via `MISSION_SET_CURRENT` (fire-and-forget). */
  async setCurrentWp(seq: number): Promise<void> {
    const vehicle = this.requireVehicle(0);
    await Promise.resolve(
      this.sendMessage('MISSION_SET_CURRENT', {
        target_system: vehicle.sysid,
        target_component: vehicle.compid,
        seq,
      }),
    );
  }

  /**
   * Tear down: unsubscribe the ACK tap and reject any in-flight commands. Not
   * part of the frozen interface; call when discarding the client.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    for (const p of [...this.pending]) {
      this.settle(p, () => p.reject(new CommandError('command client disposed', 'aborted', p.cmd)));
    }
  }

  // --- internals ----------------------------------------------------------

  /** Resolve the active vehicle or throw a typed `no-vehicle` error. */
  private requireVehicle(cmd: number): ActiveVehicle {
    const vehicle = this.getActiveVehicle();
    if (vehicle === undefined) throw new CommandError('no active vehicle', 'no-vehicle', cmd);
    return vehicle;
  }

  /** Reverse-resolve a mode name to an ArduPilot `custom_mode` for `cls`. */
  private resolveCustomMode(cls: VehicleClass, mode: string): number {
    const table = arduMapForClass(cls);
    if (table !== undefined) {
      for (const [value, name] of Object.entries(table)) {
        if (name === mode) return Number(value);
      }
    }
    throw new CommandError(
      `unknown mode "${mode}" for vehicle class "${cls}"`,
      'rejected',
      CMD_DO_SET_MODE,
    );
  }

  /** Encode + send (or resend) the COMMAND_LONG / COMMAND_INT for `p`. */
  private transmit(p: Pending): void {
    const [param1, param2, param3, param4, p5, p6, p7] = p.params;
    const fields: Record<string, unknown> = p.int
      ? {
          target_system: p.sysid,
          target_component: p.compid,
          frame: p.frame,
          command: p.cmd,
          current: 0,
          autocontinue: 0,
          param1,
          param2,
          param3,
          param4,
          x: Math.round(p5),
          y: Math.round(p6),
          z: p7,
        }
      : {
          target_system: p.sysid,
          target_component: p.compid,
          command: p.cmd,
          confirmation: p.confirm,
          param1,
          param2,
          param3,
          param4,
          param5: p5,
          param6: p6,
          param7: p7,
        };
    const name = p.int ? 'COMMAND_INT' : 'COMMAND_LONG';
    Promise.resolve(this.sendMessage(name, fields)).catch((err: unknown) => {
      this.settle(p, () =>
        p.reject(
          new CommandError(
            `failed to send command ${p.cmd}: ${err instanceof Error ? err.message : String(err)}`,
            'send-failed',
            p.cmd,
          ),
        ),
      );
    });
  }

  /** Retry/timeout tick: resend (bounded) or reject on exhaustion / stalled progress. */
  private tick(p: Pending): void {
    if (p.settled) return;
    if (p.inProgress) {
      this.settle(p, () =>
        p.reject(new CommandError(`command ${p.cmd} stalled in progress`, 'timeout', p.cmd)),
      );
      return;
    }
    if (p.attempts >= this.maxAttempts) {
      this.settle(p, () =>
        p.reject(
          new CommandError(
            `command ${p.cmd} timed out after ${p.attempts} attempts`,
            'timeout',
            p.cmd,
          ),
        ),
      );
      return;
    }
    p.attempts += 1;
    p.confirm += 1;
    this.transmit(p);
    p.cancelTimer = this.clock.setTimeout(() => this.tick(p), this.resendMs);
  }

  /** Correlate an incoming COMMAND_ACK to a pending command and advance it. */
  private onAck(msg: DecodedMessage): void {
    const cmd = num(msg.fields, 'command');
    const result = num(msg.fields, 'result');
    if (cmd === undefined || result === undefined) return;

    const candidates = this.pending.filter(
      (p) => !p.settled && p.cmd === cmd && p.sysid === msg.sysid,
    );
    if (candidates.length === 0) return;
    const p = candidates.find((c) => c.compid === msg.compid) ?? candidates[0];
    if (p === undefined) return;

    if (result === MAV_RESULT.IN_PROGRESS) {
      p.inProgress = true;
      const progress = num(msg.fields, 'progress');
      if (progress !== undefined && progress >= 0 && progress <= 100) p.progressPct = progress;
      p.cancelTimer?.();
      p.cancelTimer = this.clock.setTimeout(() => this.tick(p), this.progressTimeoutMs);
      return;
    }
    if (result === MAV_RESULT.ACCEPTED) {
      this.settle(p, () =>
        p.resolve({
          result,
          ...(p.progressPct !== undefined ? { progressPct: p.progressPct } : {}),
        }),
      );
      return;
    }
    if (result === MAV_RESULT.TEMPORARILY_REJECTED) {
      // Transient: leave the retry timer running so we resend and try again.
      return;
    }
    // DENIED / UNSUPPORTED / FAILED / *_ONLY → terminal failure.
    this.settle(p, () =>
      p.reject(
        new CommandError(`command ${cmd} rejected: ${resultName(result)}`, 'rejected', cmd, result),
      ),
    );
  }

  /** Finalize a pending command exactly once: cancel timers, detach, run `done`. */
  private settle(p: Pending, done: () => void): void {
    if (p.settled) return;
    p.settled = true;
    p.cancelTimer?.();
    p.abortCleanup?.();
    const i = this.pending.indexOf(p);
    if (i >= 0) this.pending.splice(i, 1);
    done();
  }
}

/** Construct a {@link CommandClient} (ergonomic factory mirroring sibling services). */
export function createCommandClient(deps: CommandClientDeps): CommandClient {
  return new CommandClient(deps);
}
