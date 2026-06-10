/**
 * Public types for the instrument gauges widget (task T2.2; spec plan/04 §4.2
 * "Telemetry panels & instruments", plan/05 §5.5).
 *
 * Every gauge is a presentational Solid component that takes REACTIVE accessor
 * props (e.g. `vehicle: () => VehicleState | undefined`). The container/store is
 * wired by the Flight screen (T2.11) — the gauges themselves never touch the
 * store or a Worker, so they stay composable and unit-testable.
 *
 * `RcState` and `NavProgress` are widget-LOCAL view models: the RC channels and
 * the current-WP/distance/ETA progress are NOT part of the frozen
 * {@link VehicleState} contract (`src/contracts/vehicle.ts`), so T2.11 maps its
 * sources (registry / mission service) into these shapes when wiring the gauges.
 */
import type { LinkStats } from '../../../contracts';
import type { VehicleState } from '../../../contracts';
import type { UnitHook } from './units';
import type { TFn } from '../../../core/i18n';

/** The i18n translate function (matches `core/i18n` `t` and `PanelApi.t`). */
export type { TFn };

/** Interpolation variables for a translated label. */
export type LabelVars = Record<string, string | number>;

/** Non-color status cue for a reading (drawn as text + a `data-status` attr). */
export type GaugeStatus = 'ok' | 'warn' | 'error' | 'neutral';

/**
 * One labelled value row inside a value-card gauge. Either a pre-formatted
 * literal {@link value} (already locale-formatted) OR a {@link valueKey} (an
 * i18n key resolved by the card) is shown — never both. A missing value renders
 * the neutral `gauges.value.none` placeholder.
 */
export interface GaugeReading {
  /** i18n key for the row label. */
  labelKey: string;
  /** Optional interpolation vars for {@link labelKey} (e.g. a channel number). */
  labelVars?: LabelVars;
  /** Pre-formatted literal value (locale number/string). */
  value?: string;
  /** i18n key whose translation is the value (for enum-like values). */
  valueKey?: string;
  /** i18n key for a trailing unit symbol. */
  unitKey?: string;
  /** Non-color status cue; defaults to `neutral`. */
  status?: GaugeStatus;
}

/** RC input/output channels (widget-local; T2.11 maps RC_CHANNELS / servo out). */
export interface RcState {
  /** RC input channel values in microseconds (e.g. `RC_CHANNELS`). */
  inputs: readonly number[];
  /** Servo output channel values in microseconds (e.g. `SERVO_OUTPUT_RAW`). */
  outputs: readonly number[];
}

/** Active-mission progress (widget-local; T2.11 maps mission/registry state). */
export interface NavProgress {
  /** Current waypoint sequence index. */
  currentWp: number;
  /** Total waypoints in the active mission, when known. */
  totalWp?: number;
  /** Distance to the current waypoint in metres, when known. */
  distanceM?: number;
  /** Estimated time of arrival in seconds, when known. */
  etaS?: number;
}

/**
 * Props shared by every gauge component. All data inputs are REACTIVE accessors
 * so the gauge re-renders when the store patches. `link`, `rc` and `nav` are
 * optional: the link gauge falls back to `vehicle().link`, while RC and nav
 * gauges show their empty state when their source is absent ("when present").
 */
export interface GaugeProps {
  /** Reactive accessor for the active vehicle's derived state. */
  vehicle: () => VehicleState | undefined;
  /** Reactive accessor for link stats; defaults to `vehicle().link`. */
  link?: () => LinkStats | undefined;
  /** Reactive accessor for RC channels (when the source exposes them). */
  rc?: () => RcState | undefined;
  /** Reactive accessor for active-mission progress. */
  nav?: () => NavProgress | undefined;
  /** i18n translate function. */
  t: TFn;
  /** Unit-conversion hook; defaults to {@link import('./units').metricUnits}. */
  units: UnitHook;
}
