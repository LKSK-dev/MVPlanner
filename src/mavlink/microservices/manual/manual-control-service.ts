/**
 * {@link ManualControlService} — maps a gamepad onto `RC_CHANNELS_OVERRIDE`
 * (msg 70) or `MANUAL_CONTROL` (msg 69) for manual vehicle control (task T8.6;
 * spec plan/04 §4.2 joystick, gated per plan/08 §8.2).
 *
 * SAFETY: this drives the vehicle. It is therefore OFF by default and only
 * emits frames between {@link ManualControlService.start} and `stop()`, after
 * an optional armed-state gate, and at a bounded rate. The caller pumps it via
 * {@link ManualControlService.tick} (one call per animation frame); the service
 * rate-limits sends off the injected clock so a fast pump cannot flood the link.
 *
 * FAILSAFE: `stop()` ceases sending and (by default) emits one neutralising
 * release frame (all override channels ignored / neutral manual stick). If the
 * gamepad disappears while active, `tick()` triggers the same failsafe and
 * reports a `'gamepad-disconnect'` stop so the UI can react. The Flight-screen
 * widget additionally wires `window` blur → `stop()` for focus-loss safety.
 *
 * Everything is injected ({@link ManualControlDeps}) so the service unit-tests
 * with a fake gamepad, a fake clock and a capturing `send` — no real Gamepad API.
 */
import { axisToManual, axisToPulse, clamp, RC_OVERRIDE_IGNORE, shapeAxis } from './transform';
import type { AxisShape } from './transform';
import {
  DEFAULT_RATE_HZ,
  MAX_RATE_HZ,
  MIN_RATE_HZ,
  MSG_MANUAL_CONTROL,
  MSG_RC_CHANNELS_OVERRIDE,
  RC_OVERRIDE_CHANNELS,
} from './constants';
import type {
  ActionListener,
  ActiveListener,
  GamepadSnapshot,
  GamepadSource,
  ManualControlConfig,
  ManualControlDeps,
  ManualStopReason,
  ManualTarget,
} from './types';

/** The shipped default configuration (RC mode, 25 Hz, safety gates off). */
export const DEFAULT_MANUAL_CONFIG: ManualControlConfig = {
  mode: 'rc',
  rateHz: DEFAULT_RATE_HZ,
  rcChannels: [],
  manualAxes: {},
  buttons: [],
  requireArmed: false,
  releaseOnStop: true,
};

/** Default override target when none is injected. */
const DEFAULT_TARGET: ManualTarget = { sysid: 1, compid: 1 };

/** A gamepad source that never reports a pad (the safe default). */
const NO_GAMEPAD: GamepadSource = () => undefined;

/** Default monotonic-ish clock: `performance.now` when present, else `Date.now`. */
function defaultNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/** Clamp a requested rate into the accepted `[MIN, MAX]` Hz band. */
function clampRate(hz: number): number {
  return clamp(Number.isFinite(hz) ? hz : DEFAULT_RATE_HZ, MIN_RATE_HZ, MAX_RATE_HZ);
}

/** Read axis `i` from a snapshot, treating a missing axis as centred (`0`). */
function readAxis(gp: GamepadSnapshot, i: number): number {
  const v = gp.axes[i];
  return v === undefined ? 0 : v;
}

/** True when the button at `i` is currently pressed. */
function isPressed(gp: GamepadSnapshot, i: number): boolean {
  return gp.buttons[i]?.pressed === true;
}

/** Manual-control microservice. See the file header for the safety contract. */
export class ManualControlService {
  private readonly sendFn: ManualControlDeps['send'];
  private readonly getGamepad: GamepadSource;
  private readonly now: () => number;
  private readonly getTarget: () => ManualTarget | undefined;
  private readonly isArmed: (() => boolean) | undefined;
  private readonly activeListeners = new Set<ActiveListener>();
  private readonly actionListeners = new Set<ActionListener>();

  private config: ManualControlConfig;
  private active = false;
  private disposed = false;
  /** Timestamp of the last sent frame, or `undefined` to force an immediate send. */
  private lastSendAt: number | undefined;
  /** Previous per-button pressed state, for action rising-edge detection. */
  private prevPressed = new Map<number, boolean>();

  constructor(deps: ManualControlDeps) {
    this.sendFn = deps.send;
    this.getGamepad = deps.getGamepad ?? NO_GAMEPAD;
    this.now = deps.now ?? defaultNow;
    this.getTarget = deps.getTarget ?? (() => DEFAULT_TARGET);
    this.isArmed = deps.isArmed;
    this.config = {
      ...DEFAULT_MANUAL_CONFIG,
      ...deps.config,
      rateHz: clampRate(deps.config?.rateHz ?? DEFAULT_RATE_HZ),
    };
  }

  /** Whether the service is currently enabled (sending between start/stop). */
  isActive(): boolean {
    return this.active;
  }

  /** A read-only view of the current configuration. */
  getConfig(): ManualControlConfig {
    return this.config;
  }

  /**
   * Merge `patch` onto the current config (rate re-clamped). Mappings/buttons
   * fully replace when provided. Safe to call while active.
   */
  setConfig(patch: Partial<ManualControlConfig>): void {
    const merged = { ...this.config, ...patch };
    const rateHz = patch.rateHz !== undefined ? clampRate(patch.rateHz) : merged.rateHz;
    this.config = { ...merged, rateHz };
  }

  /**
   * ENABLE manual control. Resets the rate limiter so the next {@link tick}
   * sends immediately and clears button edge state. No-op if already active or
   * disposed.
   */
  start(): void {
    if (this.disposed || this.active) return;
    this.active = true;
    this.lastSendAt = undefined;
    this.prevPressed.clear();
    this.emitActive(true);
  }

  /**
   * DISABLE manual control. Ceases sending and, when
   * {@link ManualControlConfig.releaseOnStop}, emits one neutralising release
   * frame. No-op if not active.
   */
  stop(reason: ManualStopReason = 'user'): void {
    if (!this.active) return;
    this.active = false;
    this.lastSendAt = undefined;
    this.prevPressed.clear();
    if (this.config.releaseOnStop) this.sendRelease();
    this.emitActive(false, reason);
  }

  /**
   * Pump one frame. Reads the gamepad, applies the shaping pipeline and, subject
   * to the armed gate and rate limit, sends an `RC_CHANNELS_OVERRIDE` or
   * `MANUAL_CONTROL` frame. If the pad vanished while active this FAILSAFE-stops
   * with a `'gamepad-disconnect'` reason. No-op when inactive.
   */
  tick(): void {
    if (!this.active) return;

    const gp = this.getGamepad();
    if (gp === undefined || gp.connected === false) {
      this.stop('gamepad-disconnect');
      return;
    }

    // Button-bound actions fire on the press edge regardless of the rate limit.
    this.dispatchActions(gp);

    // Armed gate: suppress sends (but stay active) when arming is required and
    // the vehicle is not armed.
    if (this.config.requireArmed && this.isArmed?.() !== true) return;

    const t = this.now();
    const interval = 1000 / this.config.rateHz;
    if (this.lastSendAt !== undefined && t - this.lastSendAt < interval) return;
    this.lastSendAt = t;

    if (this.config.mode === 'rc') this.sendRcOverride(gp);
    else this.sendManualControl(gp);
  }

  /** Subscribe to active-state changes; returns an unsubscribe fn. */
  onActiveChange(cb: ActiveListener): () => void {
    this.activeListeners.add(cb);
    return () => {
      this.activeListeners.delete(cb);
    };
  }

  /** Subscribe to button-bound action edges; returns an unsubscribe fn. */
  onAction(cb: ActionListener): () => void {
    this.actionListeners.add(cb);
    return () => {
      this.actionListeners.delete(cb);
    };
  }

  /** Tear down: failsafe-stop and drop all listeners. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop('dispose');
    this.activeListeners.clear();
    this.actionListeners.clear();
  }

  // --- internals ----------------------------------------------------------

  /** Build the base override field map with every channel released (ignored). */
  private blankOverride(): Record<string, unknown> {
    const target = this.getTarget() ?? DEFAULT_TARGET;
    const fields: Record<string, unknown> = {
      target_system: target.sysid,
      target_component: target.compid,
    };
    for (let ch = 1; ch <= RC_OVERRIDE_CHANNELS; ch++) {
      fields[`chan${ch}_raw`] = RC_OVERRIDE_IGNORE;
    }
    return fields;
  }

  /** Encode + send an `RC_CHANNELS_OVERRIDE` frame from the current gamepad. */
  private sendRcOverride(gp: GamepadSnapshot): void {
    const fields = this.blankOverride();
    for (const m of this.config.rcChannels) {
      if (m.channel < 1 || m.channel > RC_OVERRIDE_CHANNELS) continue;
      const shaped = shapeAxis(readAxis(gp, m.axis), m.shape);
      fields[`chan${m.channel}_raw`] = axisToPulse(shaped, m.range);
    }
    void this.dispatchSend(MSG_RC_CHANNELS_OVERRIDE, fields);
  }

  /** Encode + send a `MANUAL_CONTROL` frame from the current gamepad. */
  private sendManualControl(gp: GamepadSnapshot): void {
    const target = this.getTarget() ?? DEFAULT_TARGET;
    const axes = this.config.manualAxes;
    const axis = (m: { axis: number; shape: AxisShape } | undefined): number =>
      m === undefined ? 0 : axisToManual(shapeAxis(readAxis(gp, m.axis), m.shape));
    void this.dispatchSend(MSG_MANUAL_CONTROL, {
      target: target.sysid,
      x: axis(axes.x),
      y: axis(axes.y),
      z: axis(axes.z),
      r: axis(axes.r),
      buttons: this.buttonMask(gp),
    });
  }

  /** Emit a single neutralising frame (released override / neutral stick). */
  private sendRelease(): void {
    if (this.config.mode === 'rc') {
      void this.dispatchSend(MSG_RC_CHANNELS_OVERRIDE, this.blankOverride());
      return;
    }
    const target = this.getTarget() ?? DEFAULT_TARGET;
    void this.dispatchSend(MSG_MANUAL_CONTROL, {
      target: target.sysid,
      x: 0,
      y: 0,
      z: 0,
      r: 0,
      buttons: 0,
    });
  }

  /** Compute the `MANUAL_CONTROL` button mask from pressed, bit-bound buttons. */
  private buttonMask(gp: GamepadSnapshot): number {
    let mask = 0;
    for (const b of this.config.buttons) {
      if (b.bit === undefined || b.bit < 0 || b.bit > 15) continue;
      if (isPressed(gp, b.button)) mask |= 1 << b.bit;
    }
    return mask;
  }

  /** Fire `action` listeners on each button's rising (press) edge. */
  private dispatchActions(gp: GamepadSnapshot): void {
    for (const b of this.config.buttons) {
      const pressed = isPressed(gp, b.button);
      const was = this.prevPressed.get(b.button) ?? false;
      this.prevPressed.set(b.button, pressed);
      if (b.action !== undefined && pressed && !was) {
        for (const cb of this.actionListeners) cb(b.action);
      }
    }
  }

  /** Send a frame, swallowing rejections (the link layer surfaces errors). */
  private async dispatchSend(name: string, fields: Record<string, unknown>): Promise<void> {
    try {
      await this.sendFn(name, fields);
    } catch {
      /* transport/link errors are surfaced by the connection layer */
    }
  }

  private emitActive(active: boolean, reason?: ManualStopReason): void {
    for (const cb of this.activeListeners) cb(active, reason);
  }
}

/** Construct a {@link ManualControlService} (ergonomic factory, mirrors siblings). */
export function createManualControlService(deps: ManualControlDeps): ManualControlService {
  return new ManualControlService(deps);
}
