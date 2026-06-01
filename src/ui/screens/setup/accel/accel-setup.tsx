/**
 * Accelerometer + level calibration setup step (task T5.4; spec plan/04 §4.4
 * accel). The step is a thin, accessible Solid UI over the injected
 * `CalibrationClient` seam:
 *  - Start runs `accel6Point(step, signal)`; each `step(face)` call opens a
 *    user-position gate that resolves only when the user clicks the positioned
 *    button.
 *  - The pane shows the current required orientation, `face N of 6` progress,
 *    and an ordered pose guide.
 *  - A separate Calibrate Level button runs `level(signal)`.
 */
import {
  For,
  Show,
  createMemo,
  createSignal,
  onCleanup,
  type Accessor,
  type Component,
  type JSX,
} from 'solid-js';
import { t } from '../../../../core/i18n';
import type { CalibrationClient } from '../../../../contracts';
import type { SetupStep, SetupStepApi } from '../framework';
import {
  ACCEL_FACE_SEQUENCE,
  accelFaceDefinition,
  accelFaceProgress,
  accelFlowStatusKey,
  flowsToSettledStatus,
  levelFlowStatusKey,
  normalizeAccelFace,
  type AccelFaceId,
  type AccelFlowState,
  type LevelFlowState,
} from './derivation';
import { registerAccelMessages } from './messages';
import './accel-setup.css';

registerAccelMessages();

/** Construction dependencies for {@link createAccelStep}. */
export interface AccelStepDeps {
  /** Calibration microservice; only accelerometer 6-point and level are used. */
  readonly calibration: Pick<CalibrationClient, 'accel6Point' | 'level'>;
}

interface PendingGate {
  readonly face: AccelFaceId;
  resolve(): void;
  reject(err: Error): void;
  cleanup(): void;
}

function unknownFaceError(face: string): Error {
  return new Error(`unknown accelerometer calibration face: ${face}`);
}

function cloneWithFace(set: ReadonlySet<AccelFaceId>, face: AccelFaceId): ReadonlySet<AccelFaceId> {
  const next = new Set(set);
  next.add(face);
  return next;
}

function allFacesComplete(): ReadonlySet<AccelFaceId> {
  return new Set(ACCEL_FACE_SEQUENCE.map((face) => face.id));
}

/**
 * Create the Accelerometer calibration {@link SetupStep}. Flow state is owned by
 * the factory so the `status` accessor stays synchronized with the rendered pane.
 */
export function createAccelStep(deps: AccelStepDeps): SetupStep {
  const [accelFlow, setAccelFlow] = createSignal<AccelFlowState>('idle');
  const [levelFlow, setLevelFlow] = createSignal<LevelFlowState>('idle');
  const [activeFace, setActiveFace] = createSignal<AccelFaceId | undefined>(undefined);
  const [completedFaces, setCompletedFaces] = createSignal<ReadonlySet<AccelFaceId>>(new Set());
  const [gateReady, setGateReady] = createSignal(false);

  let accelController: AbortController | undefined;
  let levelController: AbortController | undefined;
  let activeGate: PendingGate | undefined;
  let accelRunId = 0;
  let levelRunId = 0;

  const clearGate = (): void => {
    activeGate?.cleanup();
    activeGate = undefined;
    setGateReady(false);
  };

  const waitForFace = (rawFace: string, signal: AbortSignal): Promise<void> => {
    const face = normalizeAccelFace(rawFace);
    if (face === undefined) return Promise.reject(unknownFaceError(rawFace));

    activeGate?.reject(new Error('superseded accelerometer calibration face'));
    setActiveFace(face);
    setGateReady(true);

    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        reject(new Error('accelerometer calibration aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      activeGate = {
        face,
        resolve: (): void => {
          signal.removeEventListener('abort', onAbort);
          if (activeGate?.face === face) {
            activeGate = undefined;
            setGateReady(false);
          }
          resolve();
        },
        reject: (err): void => {
          signal.removeEventListener('abort', onAbort);
          if (activeGate?.face === face) {
            activeGate = undefined;
            setGateReady(false);
          }
          reject(err);
        },
        cleanup: (): void => {
          signal.removeEventListener('abort', onAbort);
        },
      };
    });
  };

  const startAccel = (): void => {
    accelController?.abort();
    accelRunId += 1;
    const runId = accelRunId;
    const ac = new AbortController();
    accelController = ac;
    clearGate();
    setCompletedFaces(new Set<AccelFaceId>());
    setActiveFace(undefined);
    setAccelFlow('running');

    void deps.calibration
      .accel6Point((face) => waitForFace(face, ac.signal), ac.signal)
      .then(() => {
        if (ac.signal.aborted || runId !== accelRunId) return;
        clearGate();
        setCompletedFaces(allFacesComplete());
        setActiveFace(undefined);
        setAccelFlow('done');
      })
      .catch(() => {
        if (ac.signal.aborted || runId !== accelRunId) return;
        clearGate();
        setAccelFlow('warning');
      });
  };

  const confirmPositioned = (): void => {
    const gate = activeGate;
    if (gate === undefined) return;
    setCompletedFaces((faces) => cloneWithFace(faces, gate.face));
    gate.resolve();
  };

  const startLevel = (): void => {
    levelController?.abort();
    levelRunId += 1;
    const runId = levelRunId;
    const ac = new AbortController();
    levelController = ac;
    setLevelFlow('running');

    void deps.calibration
      .level(ac.signal)
      .then(() => {
        if (ac.signal.aborted || runId !== levelRunId) return;
        setLevelFlow('done');
      })
      .catch(() => {
        if (ac.signal.aborted || runId !== levelRunId) return;
        setLevelFlow('warning');
      });
  };

  const Pane: Component<{ api: SetupStepApi }> = (props) => {
    onCleanup(() => {
      accelController?.abort();
      levelController?.abort();
      clearGate();
    });
    return (
      <AccelPane
        api={props.api}
        accelFlow={accelFlow}
        levelFlow={levelFlow}
        activeFace={activeFace}
        completedFaces={completedFaces}
        gateReady={gateReady}
        onStartAccel={startAccel}
        onConfirmPositioned={confirmPositioned}
        onStartLevel={startLevel}
      />
    );
  };

  return {
    id: 'accel',
    title: t('setup.accel.title'),
    icon: '▣',
    safetyNote: t('setup.accel.safety'),
    status: () => flowsToSettledStatus(accelFlow(), levelFlow()),
    allowManualComplete: false,
    render: (api): JSX.Element => <Pane api={api} />,
  };
}

interface AccelPaneProps {
  readonly api: SetupStepApi;
  readonly accelFlow: Accessor<AccelFlowState>;
  readonly levelFlow: Accessor<LevelFlowState>;
  readonly activeFace: Accessor<AccelFaceId | undefined>;
  readonly completedFaces: Accessor<ReadonlySet<AccelFaceId>>;
  readonly gateReady: Accessor<boolean>;
  readonly onStartAccel: () => void;
  readonly onConfirmPositioned: () => void;
  readonly onStartLevel: () => void;
}

/** Guided accelerometer pane with the six-pose user gate and level action. */
const AccelPane: Component<AccelPaneProps> = (props) => {
  const tr = props.api.t;
  const running = (): boolean => props.accelFlow() === 'running';
  const current = createMemo(() => {
    const id = props.activeFace();
    return id === undefined ? undefined : accelFaceDefinition(id);
  });
  const progress = createMemo(() => {
    const id = props.activeFace();
    return id === undefined ? undefined : accelFaceProgress(id);
  });
  const currentText = createMemo(() => {
    const face = current();
    const p = progress();
    if (face === undefined || p === undefined) return tr('setup.accel.current.pending');
    return tr('setup.accel.current.face', {
      label: tr(face.labelKey),
      current: p.current,
      total: p.total,
      instruction: tr(face.instructionKey),
    });
  });

  return (
    <div class="mvp-accel" data-flow={props.accelFlow()}>
      <p class="mvp-accel__intro">{tr('setup.accel.intro')}</p>

      <div class="mvp-accel__controls">
        <button
          type="button"
          class="mvp-accel__btn mvp-accel__btn--start"
          data-testid="accel-start"
          disabled={running()}
          onClick={(): void => {
            props.onStartAccel();
          }}
        >
          {props.accelFlow() === 'done' || props.accelFlow() === 'warning'
            ? tr('setup.accel.restart')
            : tr('setup.accel.start')}
        </button>
        <button
          type="button"
          class="mvp-accel__btn mvp-accel__btn--level"
          data-testid="accel-level"
          disabled={props.levelFlow() === 'running'}
          onClick={(): void => {
            props.onStartLevel();
          }}
        >
          {tr('setup.accel.level.button')}
        </button>
      </div>

      <p class="mvp-accel__status" role="status" aria-live="polite" data-testid="accel-status">
        {tr(accelFlowStatusKey(props.accelFlow()))}
      </p>

      <section class="mvp-accel__current" aria-labelledby="mvp-accel-current-title">
        <h3 id="mvp-accel-current-title" class="mvp-accel__currenttitle">
          {progress() === undefined
            ? tr('setup.accel.current.pending')
            : tr('setup.accel.progress', {
                current: progress()?.current ?? 0,
                total: progress()?.total ?? ACCEL_FACE_SEQUENCE.length,
              })}
        </h3>
        <p
          class="mvp-accel__currenttext"
          role="status"
          aria-live="polite"
          data-testid="accel-current-face"
        >
          {currentText()}
        </p>
        <Show when={current()}>
          {(face) => (
            <pre class="mvp-accel__graphic" aria-hidden="true" data-testid="accel-graphic">
              {face().graphic}
            </pre>
          )}
        </Show>
        <button
          type="button"
          class="mvp-accel__btn mvp-accel__btn--positioned"
          data-testid="accel-positioned"
          disabled={!running() || !props.gateReady()}
          aria-disabled={!running() || !props.gateReady()}
          aria-label={
            props.gateReady() ? tr('setup.accel.positioned') : tr('setup.accel.positioned.disabled')
          }
          onClick={(): void => {
            props.onConfirmPositioned();
          }}
        >
          {tr('setup.accel.positioned')}
        </button>
      </section>

      <ol class="mvp-accel__faces" data-testid="accel-face-list">
        <For each={ACCEL_FACE_SEQUENCE}>
          {(face) => {
            const isCurrent = (): boolean => props.activeFace() === face.id;
            const isDone = (): boolean => props.completedFaces().has(face.id);
            return (
              <li
                class="mvp-accel__face"
                classList={{ 'is-current': isCurrent(), 'is-done': isDone() }}
                data-face={face.id}
                aria-current={isCurrent() ? 'step' : undefined}
              >
                <span class="mvp-accel__facegraphic" aria-hidden="true">
                  {face.graphic}
                </span>
                <span class="mvp-accel__facelabel">{tr(face.labelKey)}</span>
                <span class="mvp-accel__faceinstruction">{tr(face.instructionKey)}</span>
                <span class="mvp-accel__facestate">
                  {isCurrent()
                    ? tr('setup.accel.face.current')
                    : isDone()
                      ? tr('setup.accel.face.done')
                      : tr('setup.accel.face.todo')}
                </span>
              </li>
            );
          }}
        </For>
      </ol>

      <Show when={props.accelFlow() === 'warning'}>
        <p class="mvp-accel__error" role="alert" data-testid="accel-error">
          {tr('setup.accel.error')}
        </p>
      </Show>

      <section class="mvp-accel__level" aria-labelledby="mvp-accel-level-title">
        <h3 id="mvp-accel-level-title">{tr('setup.accel.level.title')}</h3>
        <p>{tr('setup.accel.level.body')}</p>
        <p
          class="mvp-accel__levelstatus"
          role="status"
          aria-live="polite"
          data-testid="accel-level-status"
        >
          {tr(levelFlowStatusKey(props.levelFlow()))}
        </p>
      </section>
    </div>
  );
};
