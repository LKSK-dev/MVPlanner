/**
 * Joystick / manual-control wiring + transport gating (task T8.6 integration;
 * spec plan/04 §4.2 joystick, gated per plan/08 §8.2/§8.3).
 *
 * SAFETY-relevant: this arms live manual vehicle control. It is wired at the
 * CONNECTION level (not the Flight screen) because the gate depends on the
 * ACTIVE TRANSPORT id, which only the {@link import('../../../transport/manager').ConnectionManager}
 * knows. It:
 *
 *  - constructs a {@link ManualControlService} bound to the host `sendMessage`,
 *    a real Gamepad-API polling source, and the store's active-vehicle target +
 *    armed gate;
 *  - GATES enabling by transport suitability: serial/Bluetooth links are OK,
 *    WebSocket/WebRTC bridges WARN (high latency), and replay/no-link are
 *    BLOCKED. The {@link GatedManualControlService} refuses `start()` on a
 *    blocked link and toasts a warning on a warned link;
 *  - registers the {@link Joystick} as a dockable panel AND a ⌘K command that
 *    pops it out into a floating window. The widget keeps its own focus-loss
 *    failsafe (window blur → stop).
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type { AppState, Store, UiRegistry, VehicleState } from '../../../contracts';
import {
  ManualControlService,
  type GamepadSnapshot,
  type GamepadSource,
  type ManualControlDeps,
} from '../../../mavlink/microservices/manual';
import { Joystick, registerJoystick } from '../../../ui/widgets/joystick';
import type { FailsafeTarget, TFn } from '../../../ui/widgets/joystick';
import { registerMessages } from '../../../core/i18n';
import { openFloatingPanel, type FloatingPanelHandle } from './floating-panel';
import '../../../ui/widgets/joystick/joystick.css';

/** Owned `manual.*` integration strings (gating toasts + the pop-out command). */
const MANUAL_WIRING_MESSAGES: Readonly<Record<string, string>> = {
  'manual.gate.blocked':
    'Manual control is unavailable on this link (replay/no link). Connect a serial or Bluetooth link.',
  'manual.gate.warn':
    'Manual control over a high-latency link (WebSocket/WebRTC) is risky — use with caution.',
};
registerMessages(MANUAL_WIRING_MESSAGES);

/** Stable command id for the joystick pop-out (⌘K palette). */
export const JOYSTICK_COMMAND_ID = 'joystick.open';

/** Transport suitability for live manual control. */
export type TransportSuitability = 'ok' | 'warn' | 'blocked';

/**
 * Classify a transport factory id for manual control: serial/Bluetooth are
 * low-latency and OK; WebSocket/WebRTC bridges are usable but WARN on latency;
 * everything else (replay, no link, unknown) is BLOCKED.
 */
export function transportSuitability(factoryId: string | undefined): TransportSuitability {
  switch (factoryId) {
    case 'serial':
    case 'bluetooth':
      return 'ok';
    case 'websocket':
    case 'webrtc':
      return 'warn';
    default:
      return 'blocked';
  }
}

/** The gate consulted by {@link GatedManualControlService} on each `start()`. */
export interface ManualGate {
  /** Current transport suitability. */
  suitability(): TransportSuitability;
  /** Called when a `start()` is refused on a blocked link. */
  onBlocked(): void;
  /** Called when a `start()` proceeds on a warned (high-latency) link. */
  onWarn(): void;
}

/**
 * A {@link ManualControlService} that GATES `start()` by transport suitability.
 * A blocked link refuses to enable (no frames are ever sent); a warned link
 * enables after surfacing a warning. All other behaviour is inherited.
 */
export class GatedManualControlService extends ManualControlService {
  readonly #gate: ManualGate;

  constructor(deps: ManualControlDeps, gate: ManualGate) {
    super(deps);
    this.#gate = gate;
  }

  /** Enable manual control unless the active transport is unsuitable. */
  override start(): void {
    const suitability = this.#gate.suitability();
    if (suitability === 'blocked') {
      this.#gate.onBlocked();
      return;
    }
    if (suitability === 'warn') this.#gate.onWarn();
    super.start();
  }
}

/** Build a real Gamepad-API polling source (returns the first connected pad). */
export function createGamepadSource(): GamepadSource {
  return (): GamepadSnapshot | undefined => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return undefined;
    }
    for (const pad of navigator.getGamepads()) {
      if (pad !== null && pad.connected) {
        return {
          axes: pad.axes,
          buttons: pad.buttons.map((b) => ({ pressed: b.pressed, value: b.value })),
          connected: true,
          id: pad.id,
        };
      }
    }
    return undefined;
  };
}

/** The minimal host slice the manual wiring sends through. */
export interface ManualWiringHost {
  sendMessage(name: string, fields: Record<string, unknown>): void | Promise<void>;
}

/** Construction dependencies for {@link wireManualControl}. */
export interface ManualWiringDeps {
  /** Host send seam (bound to the connection manager / host `sendMessage`). */
  readonly host: ManualWiringHost;
  /** The shared app store (active-vehicle target + armed gate). */
  readonly store: Store<AppState>;
  /** The shell registry (joystick panel + ⌘K command). */
  readonly registry: UiRegistry;
  /** Resolve the ACTIVE transport factory id (drives gating). */
  readonly getFactoryId: () => string | undefined;
  /** i18n translate function. */
  readonly t: TFn;
  /** Test seam: gamepad source (default the real Gamepad API). */
  readonly gamepad?: GamepadSource;
  /** Test seam: warning sink (default `registry.toast`). */
  readonly toast?: (kind: 'info' | 'warn' | 'error', msg: string) => void;
  /** Test seam: widget pump scheduler (default a rAF loop). */
  readonly schedule?: (cb: () => void) => () => void;
  /** Test seam: focus-loss failsafe target (default `window`). */
  readonly failsafeTarget?: FailsafeTarget;
}

/** Resolve the store's active vehicle (non-reactive snapshot read). */
function activeVehicleOf(store: Store<AppState>): VehicleState | undefined {
  const s = store.get();
  if (s.activeSysid === undefined) return undefined;
  return s.vehicles[s.activeSysid];
}

/**
 * Wire the joystick / manual-control feature: build the gated service, register
 * the dockable panel + ⌘K pop-out command. Returns a disposer that unregisters
 * both, closes the pop-out, and disposes the service (failsafe-stop).
 */
export function wireManualControl(deps: ManualWiringDeps): () => void {
  const gamepad = deps.gamepad ?? createGamepadSource();
  const toast =
    deps.toast ??
    ((kind: 'info' | 'warn' | 'error', msg: string): void => deps.registry.toast(kind, msg));

  const gate: ManualGate = {
    suitability: () => transportSuitability(deps.getFactoryId()),
    onBlocked: () => toast('warn', deps.t('manual.gate.blocked')),
    onWarn: () => toast('warn', deps.t('manual.gate.warn')),
  };

  const service = new GatedManualControlService(
    {
      send: (name, fields) => deps.host.sendMessage(name, fields),
      getGamepad: gamepad,
      getTarget: () => {
        const v = activeVehicleOf(deps.store);
        return v === undefined ? undefined : { sysid: v.sysid, compid: v.compid };
      },
      isArmed: () => activeVehicleOf(deps.store)?.armed ?? false,
    },
    gate,
  );

  const panelOpts = {
    ...(deps.schedule !== undefined ? { schedule: deps.schedule } : {}),
    ...(deps.failsafeTarget !== undefined ? { failsafeTarget: deps.failsafeTarget } : {}),
  };

  const offPanel = registerJoystick(deps.registry, service, gamepad, deps.t, panelOpts);

  let win: FloatingPanelHandle | undefined;
  const offCommand = deps.registry.registerCommand({
    id: JOYSTICK_COMMAND_ID,
    title: deps.t('joystick.open'),
    run: () => {
      if (win !== undefined) {
        win.close();
        win = undefined;
        return;
      }
      win = openFloatingPanel({
        title: deps.t('joystick.panel.label'),
        closeLabel: deps.t('joystick.disable'),
        className: 'mvp-floating-panel--joystick',
        onClose: () => {
          win = undefined;
        },
        mount: (body) =>
          render(
            () => createComponent(Joystick, { service, gamepad, t: deps.t, ...panelOpts }),
            body,
          ),
      });
    },
  });

  return () => {
    win?.close();
    win = undefined;
    offCommand();
    offPanel();
    service.dispose();
  };
}
