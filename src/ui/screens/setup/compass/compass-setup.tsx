/**
 * Compass calibration setup step (task T5.5; spec plan/04 §4.4 compass).
 *
 * Drives onboard magnetometer calibration through the injected, frozen
 * {@link CalibrationClient} seam (`compass(onProgress, signal) -> {offsets}`):
 *  - **Start** runs `compass(...)` and streams a live PROGRESS bar (completion %)
 *    plus the latest per-compass fitness reading.
 *  - **Cancel** aborts via the `AbortSignal` the seam owns — which sends
 *    `MAV_CMD_DO_CANCEL_MAG_CAL` — and returns the step to its idle state.
 *  - On success the resolved magnetometer OFFSETS are shown; an acceptable fit
 *    settles the step `done`, a poor fit (or a failure) settles it `warning`.
 *
 * Optional declination (auto vs manual `COMPASS_DEC`) and orientation
 * (`COMPASS_ORIENT`) hints are read — never written — through an optional
 * {@link ParamClient}. The step holds no MAVLink/param logic of its own; it is a
 * thin, accessible UI over those seams.
 *
 * Accessibility: the progress meter is a `role="progressbar"` with live
 * `aria-valuenow`/`aria-valuetext`, and the flow state is announced through a
 * polite `role="status"` live region.
 */
import {
  Show,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type Accessor,
  type Component,
} from 'solid-js';
import { t } from '../../../../core/i18n';
import type { CalibrationClient, ParamClient } from '../../../../contracts';
import type { SetupStep, SetupStepApi } from '../framework';
import {
  clampPct,
  deriveResultState,
  flowStatusKey,
  flowToSettledStatus,
  isPoorFitness,
  DEFAULT_POOR_FITNESS_MGAUSS,
  type CompassFlowState,
  type CompassProgress,
} from './derivation';
import { registerCompassMessages } from './messages';
import './compass-setup.css';

registerCompassMessages();

/** Construction dependencies for {@link createCompassStep}. */
export interface CompassStepDeps {
  /** Calibration microservice; only `compass(...)` is used. */
  readonly calibration: Pick<CalibrationClient, 'compass'>;
  /** Optional parameter client for read-only declination/orientation hints. */
  readonly params?: Pick<ParamClient, 'get' | 'onChange'>;
  /** Poor-fitness threshold in milligauss (default {@link DEFAULT_POOR_FITNESS_MGAUSS}). */
  readonly poorFitnessThresholdMgauss?: number;
}

/** Axis labels for the three magnetometer offset components. */
const OFFSET_AXES = ['X', 'Y', 'Z'] as const;

/** Build a {@link CompassProgress} without ever assigning an `undefined` fitness. */
function progressOf(pct: number, fitness: number | undefined): CompassProgress {
  return fitness !== undefined ? { pct: clampPct(pct), fitness } : { pct: clampPct(pct) };
}

/**
 * Create the Compass calibration {@link SetupStep}. The reactive flow state is
 * owned here (not inside `render`) so the step's `status` accessor and the pane
 * stay in sync across mounts/unmounts.
 */
export function createCompassStep(deps: CompassStepDeps): SetupStep {
  const threshold = deps.poorFitnessThresholdMgauss ?? DEFAULT_POOR_FITNESS_MGAUSS;

  const [flow, setFlow] = createSignal<CompassFlowState>('idle');
  const [progress, setProgress] = createSignal<CompassProgress>({ pct: 0 });
  const [offsets, setOffsets] = createSignal<readonly number[] | undefined>(undefined);
  const [errorKey, setErrorKey] = createSignal<string | undefined>(undefined);

  let controller: AbortController | undefined;

  const start = (): void => {
    controller?.abort();
    const ac = new AbortController();
    controller = ac;
    setOffsets(undefined);
    setErrorKey(undefined);
    setProgress({ pct: 0 });
    setFlow('running');

    void deps.calibration
      .compass((pct, fitness) => {
        if (ac.signal.aborted) return;
        setProgress((prev) => progressOf(pct, fitness ?? prev.fitness));
      }, ac.signal)
      .then((result) => {
        if (ac.signal.aborted) return;
        setOffsets(result.offsets);
        const fitness = progress().fitness;
        setFlow(
          deriveResultState(
            fitness !== undefined
              ? { kind: 'success', offsets: result.offsets, fitness }
              : { kind: 'success', offsets: result.offsets },
            threshold,
          ),
        );
      })
      .catch(() => {
        if (ac.signal.aborted) {
          setFlow('idle');
          setProgress({ pct: 0 });
          return;
        }
        setErrorKey('setup.compass.error');
        setFlow('warning');
      });
  };

  const cancel = (): void => {
    controller?.abort();
  };

  const Pane: Component<{ api: SetupStepApi }> = (props) => {
    onCleanup(() => controller?.abort());
    return (
      <CompassPane
        api={props.api}
        deps={deps}
        threshold={threshold}
        flow={flow}
        progress={progress}
        offsets={offsets}
        errorKey={errorKey}
        onStart={start}
        onCancel={cancel}
      />
    );
  };

  return {
    id: 'compass',
    title: t('setup.compass.title'),
    icon: '\u{1F9ED}',
    safetyNote: t('setup.compass.safety'),
    status: () => flowToSettledStatus(flow()),
    allowManualComplete: false,
    render: (api) => <Pane api={api} />,
  };
}

/** Props for the internal {@link CompassPane} presentational component. */
interface CompassPaneProps {
  readonly api: SetupStepApi;
  readonly deps: CompassStepDeps;
  readonly threshold: number;
  readonly flow: Accessor<CompassFlowState>;
  readonly progress: Accessor<CompassProgress>;
  readonly offsets: Accessor<readonly number[] | undefined>;
  readonly errorKey: Accessor<string | undefined>;
  readonly onStart: () => void;
  readonly onCancel: () => void;
}

/** The guided compass-calibration pane (progress, fitness, offsets, hints). */
const CompassPane: Component<CompassPaneProps> = (props) => {
  const tr = props.api.t;
  const running = (): boolean => props.flow() === 'running';
  const settled = (): boolean => props.flow() === 'done' || props.flow() === 'warning';
  const pct = (): number => Math.round(clampPct(props.progress().pct));
  const fitness = (): number | undefined => props.progress().fitness;
  const poorFit = (): boolean => isPoorFitness(fitness(), props.threshold);

  // Optional, read-only declination/orientation hints from the param client.
  const [decAuto, setDecAuto] = createSignal<boolean | undefined>(undefined);
  const [decDeg, setDecDeg] = createSignal<number | undefined>(undefined);
  const [orient, setOrient] = createSignal<number | undefined>(undefined);

  const refreshHints = (): void => {
    const params = props.deps.params;
    if (params === undefined) return;
    const autodec = params.get('COMPASS_AUTODEC');
    if (autodec !== undefined) setDecAuto(autodec.value !== 0);
    const dec = params.get('COMPASS_DEC');
    if (dec !== undefined) setDecDeg((dec.value * 180) / Math.PI);
    const o = params.get('COMPASS_ORIENT');
    if (o !== undefined) setOrient(o.value);
  };

  onMount(() => {
    refreshHints();
    const params = props.deps.params;
    if (params === undefined) return;
    const off = params.onChange((p) => {
      if (p.name === 'COMPASS_AUTODEC' || p.name === 'COMPASS_DEC' || p.name === 'COMPASS_ORIENT') {
        refreshHints();
      }
    });
    onCleanup(off);
  });

  const hasHints = createMemo(
    () => props.deps.params !== undefined && (decAuto() !== undefined || orient() !== undefined),
  );

  return (
    <div class="mvp-compass" data-flow={props.flow()}>
      <p class="mvp-compass__intro">{tr('setup.compass.intro')}</p>

      <div class="mvp-compass__controls">
        <Show
          when={running()}
          fallback={
            <button
              type="button"
              class="mvp-compass__btn mvp-compass__btn--start"
              data-testid="compass-start"
              onClick={(): void => props.onStart()}
            >
              {settled() ? tr('setup.compass.restart') : tr('setup.compass.start')}
            </button>
          }
        >
          <button
            type="button"
            class="mvp-compass__btn mvp-compass__btn--cancel"
            data-testid="compass-cancel"
            onClick={(): void => props.onCancel()}
          >
            {tr('setup.compass.cancel')}
          </button>
        </Show>
      </div>

      <p class="mvp-compass__status" role="status" aria-live="polite" data-testid="compass-status">
        {tr(flowStatusKey(props.flow()))}
      </p>

      <Show when={running() || settled()}>
        <div
          class="mvp-compass__progress"
          role="progressbar"
          aria-label={tr('setup.compass.progress.label')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct()}
          aria-valuetext={tr('setup.compass.progress.value', { pct: pct() })}
          data-testid="compass-progress"
        >
          <div class="mvp-compass__progressfill" style={{ 'inline-size': `${pct()}%` }} />
        </div>
      </Show>

      <Show when={fitness() !== undefined}>
        <p
          class="mvp-compass__fitness"
          classList={{ 'is-poor': poorFit() }}
          data-testid="compass-fitness"
        >
          <span class="mvp-compass__fitnesslabel">{tr('setup.compass.fitness.label')}</span>{' '}
          <span class="mvp-compass__fitnessvalue">
            {tr('setup.compass.fitness.value', { value: (fitness() ?? 0).toFixed(1) })}
          </span>
          <Show when={poorFit()}>
            <span class="mvp-compass__fitnesshint"> {tr('setup.compass.fitness.poor')}</span>
          </Show>
        </p>
      </Show>

      <Show when={props.errorKey()}>
        {(key) => (
          <p class="mvp-compass__error" role="alert" data-testid="compass-error">
            {tr(key())}
          </p>
        )}
      </Show>

      <Show when={props.offsets()}>
        {(values) => (
          <section class="mvp-compass__offsets" data-testid="compass-offsets">
            <h3 class="mvp-compass__offsetstitle">{tr('setup.compass.offsets.title')}</h3>
            <ul class="mvp-compass__offsetslist">
              {values().map((value, i) => (
                <li class="mvp-compass__offset">
                  {tr('setup.compass.offsets.axis', {
                    axis: OFFSET_AXES[i] ?? String(i),
                    value: value.toFixed(1),
                  })}
                </li>
              ))}
            </ul>
          </section>
        )}
      </Show>

      <Show when={hasHints()}>
        <dl class="mvp-compass__hints" data-testid="compass-hints">
          <Show when={decAuto() !== undefined}>
            <dt class="mvp-compass__hintterm">{tr('setup.compass.declination.title')}</dt>
            <dd class="mvp-compass__hintval">
              {decAuto() === true
                ? tr('setup.compass.declination.auto')
                : tr('setup.compass.declination.manual', {
                    deg: (decDeg() ?? 0).toFixed(1),
                  })}
            </dd>
          </Show>
          <Show when={orient() !== undefined}>
            <dt class="mvp-compass__hintterm">{tr('setup.compass.orientation.title')}</dt>
            <dd class="mvp-compass__hintval">
              {tr('setup.compass.orientation.value', { value: orient() ?? 0 })}
            </dd>
          </Show>
        </dl>
      </Show>
    </div>
  );
};
