/**
 * Pure progress / fitness / result-state derivation for the Compass calibration
 * setup step (task T5.5; spec plan/04 §4.4 compass). No Solid, no DOM — total
 * functions over the values the onboard `MAG_CAL` flow reports so the step's
 * completion logic is trivially unit-testable (test/unit/setup-compass-*).
 *
 * The injected {@link import('../../../../mavlink/microservices/calibration').CalibrationClient}
 * surfaces calibration purely through `compass(onProgress, signal) -> {offsets}`:
 * `onProgress(pct, fitness?)` streams completion percent (and an optional fitness
 * reading, in milligauss — lower is better), the promise resolves with the final
 * offsets on `MAG_CAL_SUCCESS`, and rejects on failure/abort. These helpers map
 * those raw signals onto the wizard's settled-status vocabulary.
 */
import type { SettledStatus } from '../framework';

/**
 * The compass step's internal flow state:
 *  - `idle`    — before Start (or after a cancel) — nothing running.
 *  - `running` — `MAG_CAL` in progress; progress + fitness stream in.
 *  - `done`    — resolved with offsets and acceptable fitness.
 *  - `warning` — resolved with poor fitness, or failed/rejected.
 */
export type CompassFlowState = 'idle' | 'running' | 'done' | 'warning';

/** Latest progress snapshot rendered while a calibration is running. */
export interface CompassProgress {
  /** Completion percentage, clamped to `0..100`. */
  readonly pct: number;
  /** Latest fitness reading in milligauss (lower is better), if reported. */
  readonly fitness?: number;
}

/**
 * Default poor-fitness threshold in milligauss. ArduPilot's `COMPASS_CAL_FITNESS`
 * defaults to ~16 mGauss ("Default"); a final reading above it is flagged as a
 * poor fit even though the firmware accepted the calibration.
 */
export const DEFAULT_POOR_FITNESS_MGAUSS = 16;

/** Clamp a reported completion percent to `0..100` (non-finite → `0`). */
export function clampPct(pct: number): number {
  if (!Number.isFinite(pct)) return 0;
  if (pct < 0) return 0;
  if (pct > 100) return 100;
  return pct;
}

/**
 * Whether a fitness reading is "poor" (worse than `threshold` mGauss). An absent
 * or non-finite reading is treated as not-poor (we cannot judge it).
 */
export function isPoorFitness(
  fitness: number | undefined,
  threshold: number = DEFAULT_POOR_FITNESS_MGAUSS,
): boolean {
  return fitness !== undefined && Number.isFinite(fitness) && fitness > threshold;
}

/** The terminal outcome of a `compass()` call, fed to {@link deriveResultState}. */
export interface CompassOutcome {
  /** `success` when `compass()` resolved with offsets; `error` when it rejected. */
  readonly kind: 'success' | 'error';
  /** Resolved magnetometer offsets `[x, y, z]` (success only). */
  readonly offsets?: readonly number[];
  /** Final fitness reading in milligauss, if one was observed (success only). */
  readonly fitness?: number;
}

/**
 * Derive the settled flow state from a terminal outcome: a rejection is always a
 * `warning`; a success is `done` unless its final fitness is {@link isPoorFitness}.
 */
export function deriveResultState(
  outcome: CompassOutcome,
  threshold: number = DEFAULT_POOR_FITNESS_MGAUSS,
): CompassFlowState {
  if (outcome.kind === 'error') return 'warning';
  return isPoorFitness(outcome.fitness, threshold) ? 'warning' : 'done';
}

/**
 * Map the internal flow state onto the wizard framework's {@link SettledStatus}.
 * `running` (and `idle`) report `todo` so that — while the step is the selected
 * one — the shell renders the transient `active` badge (see
 * {@link import('../framework').toDisplayStatus}); `done`/`warning` pass through.
 */
export function flowToSettledStatus(flow: CompassFlowState): SettledStatus {
  switch (flow) {
    case 'done':
      return 'done';
    case 'warning':
      return 'warning';
    case 'idle':
    case 'running':
    default:
      return 'todo';
  }
}

/** The i18n key describing a flow state for the live status region. */
export function flowStatusKey(flow: CompassFlowState): string {
  return `setup.compass.state.${flow}`;
}
