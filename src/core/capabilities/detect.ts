/**
 * Runtime capability detection (T0.6).
 *
 * Pure, injectable feature probing for graceful degradation across the browser
 * matrix in spec plan/01 §1.7. Detection is split from any consumer so it can be
 * unit-tested with mock globals (conventions plan/implementation/00 §0.3) — the
 * function never touches the ambient `window`/`navigator` directly; callers pass
 * the environment in. {@link detectRealCapabilities} is the thin convenience that
 * probes the real globals.
 *
 * Each probed slot is typed as `unknown` (these Web APIs are not all present in
 * the TS DOM lib, and we must not assume their shape) — presence is what matters
 * for degradation, not the concrete type.
 */

/** Minimal structural view of `navigator` used for capability probing. */
export interface CapabilityNavigator {
  /** Web Serial API entry point (`navigator.serial`). */
  readonly serial?: unknown;
  /** Web Bluetooth API entry point (`navigator.bluetooth`). */
  readonly bluetooth?: unknown;
  /** WebUSB API entry point (`navigator.usb`). */
  readonly usb?: unknown;
  /** Gamepad API accessor (`navigator.getGamepads`). */
  readonly getGamepads?: unknown;
}

/** Minimal structural view of `window`/`globalThis` used for capability probing. */
export interface CapabilityWindow {
  /** File System Access API opener (`window.showOpenFilePicker`). */
  readonly showOpenFilePicker?: unknown;
  /** OffscreenCanvas constructor (`window.OffscreenCanvas`). */
  readonly OffscreenCanvas?: unknown;
  /** WebAssembly namespace (`globalThis.WebAssembly`). */
  readonly WebAssembly?: unknown;
  /** Web Speech synthesis (`window.speechSynthesis`). */
  readonly speechSynthesis?: unknown;
  /** Secure-context flag (`isSecureContext`). */
  readonly isSecureContext?: boolean;
  /**
   * Cross-origin isolation flag (`crossOriginIsolated`); gates the
   * SharedArrayBuffer telemetry ring path per spec plan/02 §2.5.
   */
  readonly crossOriginIsolated?: boolean;
}

/** Injectable environment for {@link detectCapabilities}. */
export interface CapabilityEnv {
  readonly navigator?: CapabilityNavigator | undefined;
  readonly window?: CapabilityWindow | undefined;
}

/**
 * Typed record of detected runtime capabilities. Drives graceful-degradation
 * messaging (spec plan/01 §1.7) and the SharedArrayBuffer ring decision
 * (spec plan/02 §2.5).
 */
export interface Capabilities {
  /** Web Serial available (USB/telemetry radio) — `navigator.serial`. */
  readonly webSerial: boolean;
  /** Web Bluetooth available — `navigator.bluetooth`. */
  readonly webBluetooth: boolean;
  /** WebUSB available (Web DFU path) — `navigator.usb`. */
  readonly webUsb: boolean;
  /** File System Access API available — `window.showOpenFilePicker`. */
  readonly fileSystemAccess: boolean;
  /** WebAssembly available — `typeof WebAssembly`. */
  readonly wasm: boolean;
  /** Running in a secure context — `isSecureContext`. */
  readonly secureContext: boolean;
  /** OffscreenCanvas available (worker HUD render) — `typeof OffscreenCanvas`. */
  readonly offscreenCanvas: boolean;
  /** Cross-origin isolated; enables the SharedArrayBuffer ring (plan/02 §2.5). */
  readonly crossOriginIsolated: boolean;
  /** Web Speech synthesis available — `speechSynthesis`. */
  readonly webSpeech: boolean;
  /** Gamepad API available — `navigator.getGamepads`. */
  readonly gamepad: boolean;
}

/** True when a probed slot is populated (neither `null` nor `undefined`). */
function isPresent(value: unknown): boolean {
  return value !== undefined && value !== null;
}

/** True when a probed slot is callable (a function or constructor). */
function isCallable(value: unknown): boolean {
  return typeof value === 'function';
}

/**
 * Detect runtime capabilities from an injected environment. Pure: with no
 * argument (or empty mocks) every capability resolves to `false`, so the same
 * function can be exercised with present/absent/partial mock globals.
 *
 * @param env - Optional environment carrying `navigator`/`window` views. Omit or
 *   pass partial mocks in tests; {@link detectRealCapabilities} supplies the real
 *   globals at runtime.
 * @returns A fully-populated {@link Capabilities} record.
 */
export function detectCapabilities(env?: CapabilityEnv): Capabilities {
  const nav = env?.navigator;
  const win = env?.window;
  return {
    webSerial: isPresent(nav?.serial),
    webBluetooth: isPresent(nav?.bluetooth),
    webUsb: isPresent(nav?.usb),
    fileSystemAccess: isCallable(win?.showOpenFilePicker),
    wasm: isPresent(win?.WebAssembly),
    secureContext: win?.isSecureContext === true,
    offscreenCanvas: isCallable(win?.OffscreenCanvas),
    crossOriginIsolated: win?.crossOriginIsolated === true,
    webSpeech: isPresent(win?.speechSynthesis),
    gamepad: isCallable(nav?.getGamepads),
  };
}

/**
 * Probe the real ambient globals via {@link detectCapabilities}. Safe in both
 * window and worker contexts: it reads through `globalThis`, so no direct
 * `window`/`navigator` reference is required and a missing slot simply yields
 * `false`. Never throws.
 */
export function detectRealCapabilities(): Capabilities {
  const g = globalThis as unknown as CapabilityWindow & {
    readonly navigator?: CapabilityNavigator;
  };
  return detectCapabilities({ navigator: g.navigator, window: g });
}
