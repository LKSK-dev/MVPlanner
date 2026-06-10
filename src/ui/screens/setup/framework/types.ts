/**
 * Public types for the Setup wizard framework (task T5.2; spec plan/04 §4.4,
 * plan/05 §5.4 Setup).
 *
 * The framework is intentionally content-agnostic: it owns the left STEP LIST +
 * right guided PANE shell, navigation, completion tracking and the safety/info
 * callout. The concrete per-step setup UIs (T5.3 frame, T5.4 accel, T5.5
 * compass, T5.6 radio, T5.7 modes, T5.8 failsafe, T5.9 battery, T5.10 motors)
 * plug in by contributing a {@link SetupStep} to the {@link WizardShell}'s step
 * registry — they bring all calibration/param logic; the framework never does.
 */
import type { Accessor, JSX } from 'solid-js';
import type { TFn } from '../../../../core/i18n';

export type { TFn };

/**
 * A step's persistent (settled) status — what a step reports or derives. The
 * transient `'active'` value (the currently-selected step) is not settable by a
 * step; it is computed by the shell ({@link import('./status').toDisplayStatus}).
 *
 *  - `todo`    — not started / incomplete.
 *  - `done`    — completed successfully (counts toward completion).
 *  - `warning` — completed/attempted but needs attention (does NOT count done).
 *  - `na`      — not applicable to this vehicle (counts as satisfied).
 */
export type SettledStatus = 'todo' | 'done' | 'warning' | 'na';

/** Display status shown in the step list; adds the transient `'active'` value. */
export type StepStatus = SettledStatus | 'active';

/**
 * Injection surface handed to a step's {@link SetupStep.render}. It lets a step
 * drive its own completion + navigation without knowing about the shell:
 *
 *  - report status explicitly ({@link setStatus} / {@link markComplete} /
 *    {@link clearStatus}) — for steps without a derived {@link SetupStep.status}
 *    accessor; and
 *  - move through the wizard ({@link next} / {@link prev}).
 *
 * An explicit status set here always wins over a derived `status` accessor until
 * {@link clearStatus} is called (see {@link import('./status').resolveSettledStatus}).
 */
export interface SetupStepApi {
  /** i18n translate function (same instance threaded to the shell). */
  readonly t: TFn;
  /** Explicitly set this step's settled status (overrides any accessor). */
  setStatus(status: SettledStatus): void;
  /** Convenience for `setStatus('done')`. */
  markComplete(): void;
  /** Clear the explicit override, falling back to the `status` accessor. */
  clearStatus(): void;
  /** Navigate to the next step (no-op at the end). */
  next(): void;
  /** Navigate to the previous step (no-op at the start). */
  prev(): void;
  /** Reactive: whether this step is currently the active one. */
  readonly isActive: Accessor<boolean>;
}

/**
 * A single setup step contributed to the {@link WizardShell} registry.
 *
 * @example
 * const frameStep: SetupStep = {
 *   id: 'frame',
 *   title: t('setup.frame.title'),
 *   safetyNote: t('setup.frame.safety'),
 *   status: () => (paramsWritten() ? 'done' : 'todo'),
 *   render: (api) => <FrameSetup client={paramClient} api={api} />,
 * };
 */
export interface SetupStep {
  /** Stable, unique step id (used for tab/panel ids + override keys). */
  readonly id: string;
  /** Display title (the step module resolves it via `t()`). */
  readonly title: string;
  /** Optional decorative icon glyph/short text shown before the title. */
  readonly icon?: string;
  /**
   * Optional "what this does / safety" callout body shown above the step's
   * content (spec plan/05 §5.4). Render-only; no markup.
   */
  readonly safetyNote?: string;
  /**
   * Optional reactive accessor deriving the step's settled status (e.g. from
   * params). When omitted, the step is `'todo'` until an explicit override is
   * set through {@link SetupStepApi}.
   */
  readonly status?: Accessor<SettledStatus>;
  /**
   * Whether the shell shows its built-in "Mark complete" button for this step.
   * Defaults to `true`; steps whose status is fully derived set this `false`.
   */
  readonly allowManualComplete?: boolean;
  /** Render the step's guided content into the right pane. */
  render(api: SetupStepApi): JSX.Element;
}
