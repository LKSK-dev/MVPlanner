/**
 * Antenna-tracker reachability wiring (task T8.9 integration; spec plan/04
 * §4.12 SHOULD).
 *
 * Builds the host-bound {@link TrackerService} (detection / pointing / position
 * feed / config) and registers the {@link TrackerPanel} as a dockable panel AND
 * a ⌘K command that pops it out into a floating window — mirroring how the
 * MAVLink inspector and joystick are surfaced. The service taps the host
 * send/onMessage seams, reads the active vehicle from the store, and writes
 * config through the shared app {@link ParamClient}.
 */
import { createComponent } from 'solid-js';
import { render } from 'solid-js/web';
import type {
  DecodedMessage,
  PanelApi,
  ParamClient,
  UiRegistry,
  VehicleState,
} from '../../../contracts';
import { registerMessages, t as defaultT } from '../../../core/i18n';
import { openFloatingPanel, type FloatingPanelHandle } from '../../shell/connection/floating-panel';
import { TrackerPanel, createTrackerService } from './tracker';
import type { TFn } from './framework';

/** Owned integration string for the tracker pop-out command. */
registerMessages({ 'tracker.open.command': 'Open antenna tracker' });

/** Stable panel + command ids for the antenna tracker. */
export const TRACKER_PANEL_ID = 'widget.tracker';
export const TRACKER_COMMAND_ID = 'tracker.open';

/** The minimal host slice the tracker service taps. */
export interface TrackerWiringHost {
  sendMessage(name: string, fields: Record<string, unknown>): void | Promise<void>;
  onMessage(names: readonly string[], cb: (msg: DecodedMessage) => void): () => void;
}

/** Construction dependencies for {@link wireTracker}. */
export interface TrackerWiringDeps {
  /** Host send + decoded-message tap. */
  readonly host: TrackerWiringHost;
  /** Resolve the currently-active vehicle (its position is fed to the tracker). */
  readonly getActiveVehicle: () => VehicleState | undefined;
  /** Shared parameter microservice for tracker config (optional). */
  readonly param?: ParamClient;
  /** The shell registry (panel + ⌘K command). */
  readonly registry: UiRegistry;
  /** i18n translate function. */
  readonly t?: TFn;
}

/**
 * Wire the antenna-tracker feature: construct the service, register the dockable
 * panel + ⌘K pop-out command. Returns a disposer that unregisters both, closes
 * the pop-out and disposes the service.
 */
export function wireTracker(deps: TrackerWiringDeps): () => void {
  const t = deps.t ?? defaultT;
  const service = createTrackerService({
    sendMessage: (name, fields) => deps.host.sendMessage(name, fields),
    onMessage: (names, cb) => deps.host.onMessage(names, cb),
    getActiveVehicle: deps.getActiveVehicle,
    ...(deps.param !== undefined ? { params: deps.param } : {}),
  });

  const offPanel = deps.registry.registerPanel({
    id: TRACKER_PANEL_ID,
    title: t('tracker.title'),
    icon: 'tracker',
    mount(el: HTMLElement, api: PanelApi): () => void {
      return render(() => createComponent(TrackerPanel, { service, t: api.t }), el);
    },
  });

  let win: FloatingPanelHandle | undefined;
  const offCommand = deps.registry.registerCommand({
    id: TRACKER_COMMAND_ID,
    title: t('tracker.open.command'),
    run: () => {
      if (win !== undefined) {
        win.close();
        win = undefined;
        return;
      }
      win = openFloatingPanel({
        title: t('tracker.title'),
        closeLabel: t('tracker.open.command'),
        className: 'mvp-floating-panel--tracker',
        mount: (body) => render(() => createComponent(TrackerPanel, { service, t }), body),
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
