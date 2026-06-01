/**
 * Public types for the joystick / gamepad control panel (task T8.6; spec plan/04
 * §4.2 joystick). SAFETY-relevant: this panel arms live manual vehicle control.
 *
 * The widget is decoupled from the worker host: it drives an injected
 * {@link ManualControlService} (pure, no Worker) and reads an injected
 * {@link GamepadSource}. Tests construct a real service over a capturing `send`
 * and a fake gamepad; the Flight screen wires the host `sendMessage` + the
 * browser Gamepad API.
 */
import type { GamepadSource, ManualControlService } from '../../../mavlink/microservices/manual';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** A `window`-like target for the focus-loss failsafe (only the bits we use). */
export interface FailsafeTarget {
  addEventListener(type: 'blur', listener: () => void): void;
  removeEventListener(type: 'blur', listener: () => void): void;
}

/** {@link import('./joystick').Joystick} props. */
export interface JoystickProps {
  /** The manual-control service this panel enables/configures (injected). */
  service: ManualControlService;
  /** Live gamepad sampler for the on-screen axis/button display (injected). */
  gamepad: GamepadSource;
  /** i18n translate function. */
  t: TFn;
  /**
   * Pump scheduler: invokes `cb` repeatedly (once per frame) and returns a
   * canceller. Defaults to a `requestAnimationFrame` loop. Injected in tests so
   * the pump is deterministic (or absent). The pump refreshes the live display
   * and calls `service.tick()` while manual control is active.
   */
  schedule?: (cb: () => void) => () => void;
  /**
   * Target for the focus-loss failsafe (`blur` → `service.stop()`). Defaults to
   * the global `window`; injected in tests.
   */
  failsafeTarget?: FailsafeTarget;
}
