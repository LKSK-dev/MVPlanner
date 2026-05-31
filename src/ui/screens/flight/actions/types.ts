/**
 * Public types for the Flight actions bar (task T2.7; spec plan/04 §4.2 Actions,
 * plan/08 §8.3 destructive-action gating + audit).
 *
 * The actions layer is split so the safety-critical flow is testable without a
 * DOM: {@link import('./catalog').ACTIONS} is the pure action catalog (gating +
 * runner + summary), {@link import('./run').runAction} wraps every action in the
 * confirm→command→audit flow, and {@link import('./actions-bar').ActionsBar} is
 * the Solid view that gathers any arguments and renders the buttons.
 *
 * Everything is injected — {@link ActionsDeps} carries the {@link CommandClient},
 * the `confirm` seam ({@link UiRegistry.confirm}), the {@link AuditLog}, and the
 * active-vehicle accessor — so the whole flow unit-tests against mocks with no
 * real host (spec plan/04 §4.2 "disabled when unsafe", §8.3 gating).
 */
import type { CommandClient, ConfirmOptions, VehicleClass } from '../../../../contracts';
import type { AuditLog, AuditOrigin } from '../../../../core/audit';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Re-export the confirm seam shape for callers wiring the actions bar. */
export type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

/** Stable identifier for each quick action (spec plan/04 §4.2 list). */
export type ActionId =
  | 'arm'
  | 'disarm'
  | 'takeoff'
  | 'land'
  | 'rtl'
  | 'loiter'
  | 'auto'
  | 'pause'
  | 'resume'
  | 'setMode'
  | 'setCurrentWp'
  | 'guidedGoto'
  | 'guidedChangeAlt'
  | 'changeSpeed'
  | 'setRoi'
  | 'clearRoi'
  | 'restartMission'
  | 'emergencyStop';

/**
 * Minimal active-vehicle view the actions layer needs. A full
 * {@link import('../../../../contracts').VehicleState} is structurally
 * assignable, so T2.11 can pass the store vehicle directly; tests build a small
 * literal.
 */
export interface ActionVehicle {
  readonly vehicleClass: VehicleClass;
  readonly armed: boolean;
  readonly mode?: string;
  readonly position?: { readonly lat: number; readonly lon: number; readonly altRelM: number };
}

/** Optional per-action arguments (altitude/coords/speed/mode/seq). */
export interface ActionArgs {
  /** Target altitude in metres (takeoff / guided change-alt). */
  altM?: number;
  /** Latitude in degrees (guided go-here / ROI). */
  lat?: number;
  /** Longitude in degrees (guided go-here / ROI). */
  lon?: number;
  /** Target ground speed in m/s (change speed). */
  speedMs?: number;
  /** Flight-mode name (mode change). */
  mode?: string;
  /** Mission sequence index (set current WP). */
  seq?: number;
}

/** Derived gating context passed to {@link ActionDescriptor.isEnabled}. */
export interface ActionGateContext {
  /** Whether an active vehicle is selected. */
  readonly hasVehicle: boolean;
  /** Whether that vehicle reports armed. */
  readonly armed: boolean;
  /** Whether that vehicle is armed AND above the in-air altitude threshold. */
  readonly inAir: boolean;
  /** The active vehicle class (`unknown` when none). */
  readonly vehicleClass: VehicleClass;
}

/** Construction dependencies for {@link import('./run').runAction}. */
export interface ActionsDeps {
  /** The command microservice (frozen {@link CommandClient} contract). */
  readonly command: CommandClient;
  /** Safety-confirm seam ({@link import('../../../../contracts').UiRegistry.confirm}). */
  readonly confirm: ConfirmFn;
  /** Where action starts + results are recorded. */
  readonly audit: AuditLog;
  /** Resolve the active vehicle (used for gating + armed-aware confirmation). */
  readonly getActiveVehicle: () => ActionVehicle | undefined;
  /** i18n translate; defaults to identity (key passthrough). */
  readonly t?: TFn;
  /** Time source for audit timestamps; defaults to `Date.now`. */
  readonly now?: () => number;
  /** Audit origin recorded with each action; defaults to `'ui'`. */
  readonly origin?: AuditOrigin;
}

/** Terminal status of a {@link import('./run').runAction} call. */
export type ActionOutcomeStatus = 'ok' | 'error' | 'cancelled' | 'blocked';

/** Result of running an action through the confirm→command→audit flow. */
export interface ActionOutcome {
  /** `ok` ran + acked; `error` failed; `cancelled` declined; `blocked` disabled/no-vehicle. */
  readonly status: ActionOutcomeStatus;
  /** Id of the audit entry created (absent for `blocked`). */
  readonly entryId?: string;
  /** The thrown error when `status === 'error'`. */
  readonly error?: unknown;
  /** Why the action was `blocked` (e.g. `'disabled'`). */
  readonly reason?: string;
}

/** Altitude (m) above which an armed vehicle is treated as "in-air" for gating. */
export const IN_AIR_ALT_M = 1;
