/**
 * Public types for the manual-control microservice (task T8.6; spec plan/04
 * §4.2 joystick).
 *
 * The service is decoupled from the browser Gamepad API and the worker host via
 * injected seams ({@link ManualControlDeps}): a `send`, an optional gamepad
 * sampler ({@link GamepadSource}), a clock, an arm-state gate and an override
 * target accessor. Tests inject plain functions; the Flight screen wires the
 * real Gamepad API + host `sendMessage`.
 */
import type { AxisShape, PulseRange } from './transform';

/** The wire encoding the service maps the gamepad onto. */
export type ManualMode = 'rc' | 'manual';

/**
 * A lightweight, structural snapshot of a gamepad — the subset the service
 * reads. The browser `Gamepad` satisfies it; tests build a plain object.
 */
export interface GamepadSnapshot {
  /** Normalised axis values, each in `[-1, 1]`. */
  readonly axes: readonly number[];
  /** Button states; `pressed` drives bindings, `value` is the analog amount. */
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
  /** Whether the pad is currently connected (default assumed `true`). */
  readonly connected?: boolean;
  /** Opaque device id, surfaced for the UI. */
  readonly id?: string;
}

/** Samples the active gamepad, or returns `undefined` when none is present. */
export type GamepadSource = () => GamepadSnapshot | undefined;

/** Maps one gamepad axis onto an RC override channel, with shaping + µs range. */
export interface RcChannelMapping {
  /** Gamepad axis index to read. */
  readonly axis: number;
  /** Target RC channel number, `1…18`. */
  readonly channel: number;
  /** Shaping applied to the axis (deadzone/expo/reverse/trim). */
  readonly shape: AxisShape;
  /** Output pulse range (µs); defaults to 1000/1500/2000. */
  readonly range?: PulseRange;
}

/** Maps one gamepad axis onto a `MANUAL_CONTROL` field (`x`/`y`/`z`/`r`). */
export interface ManualAxisMapping {
  /** Gamepad axis index to read. */
  readonly axis: number;
  /** Shaping applied to the axis (deadzone/expo/reverse/trim). */
  readonly shape: AxisShape;
}

/** The four `MANUAL_CONTROL` axes; any may be left unmapped (sends `0`). */
export interface ManualAxisMap {
  readonly x?: ManualAxisMapping;
  readonly y?: ManualAxisMapping;
  readonly z?: ManualAxisMapping;
  readonly r?: ManualAxisMapping;
}

/**
 * Binds a gamepad button to a bit in the `MANUAL_CONTROL` button mask and/or a
 * named action fired once on each press (rising) edge.
 */
export interface ButtonBinding {
  /** Gamepad button index. */
  readonly button: number;
  /** Bit position `0…15` set in the `MANUAL_CONTROL` button mask while pressed. */
  readonly bit?: number;
  /** Action id dispatched once on each press edge (via `onAction`). */
  readonly action?: string;
}

/** Full manual-control configuration (every field has a documented default). */
export interface ManualControlConfig {
  /** Wire encoding: RC override or manual control. */
  readonly mode: ManualMode;
  /** Send cadence (Hz), clamped to `[1, 50]`. */
  readonly rateHz: number;
  /** Axis→channel mappings used in `'rc'` mode. */
  readonly rcChannels: readonly RcChannelMapping[];
  /** Axis map used in `'manual'` mode. */
  readonly manualAxes: ManualAxisMap;
  /** Button bindings (mask bits + actions), used in both modes for actions. */
  readonly buttons: readonly ButtonBinding[];
  /** When `true`, frames are only sent while {@link ManualControlDeps.isArmed} is true. */
  readonly requireArmed: boolean;
  /** When `true`, `stop()`/failsafe emit one neutralising release frame. */
  readonly releaseOnStop: boolean;
}

/** The `(sysid, compid)` the override frames are addressed to. */
export interface ManualTarget {
  readonly sysid: number;
  readonly compid: number;
}

/** Construction dependencies for the manual-control service. */
export interface ManualControlDeps {
  /** Encode + send a message out the active link (host `sendMessage`). */
  readonly send: (name: string, fields: Record<string, unknown>) => void | Promise<void>;
  /** Sample the active gamepad (default: a no-op source returning `undefined`). */
  readonly getGamepad?: GamepadSource;
  /** Millisecond clock for rate-limiting (default: `performance.now`/`Date.now`). */
  readonly now?: () => number;
  /** Resolve the override target sysid/compid (default `{ sysid: 1, compid: 1 }`). */
  readonly getTarget?: () => ManualTarget | undefined;
  /** Arm-state gate, consulted only when {@link ManualControlConfig.requireArmed}. */
  readonly isArmed?: () => boolean;
  /** Initial config overrides merged onto the defaults. */
  readonly config?: Partial<ManualControlConfig>;
}

/** Why the service stopped sending (drives UI messaging + audit). */
export type ManualStopReason = 'user' | 'gamepad-disconnect' | 'dispose';

/** Listener for active-state changes (drives the "manual active" indicator). */
export type ActiveListener = (active: boolean, reason?: ManualStopReason) => void;

/** Listener for button-bound action edges. */
export type ActionListener = (action: string) => void;
