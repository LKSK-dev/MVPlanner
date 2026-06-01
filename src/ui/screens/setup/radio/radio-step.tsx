/**
 * Radio (RC) calibration setup step (T5.6; spec plan/04 §4.4 radio).
 *
 * This is a GCS-side calibration flow over the injected `CalibrationClient.radio`
 * stream: Start subscribes to raw RC channel arrays, the pure capture helper
 * accumulates per-channel min/max while keeping the latest resting-center value
 * as trim, and Save writes `RCn_MIN`, `RCn_MAX`, and `RCn_TRIM` via the injected
 * parameter client before aborting the stream.
 */
import { For, Show, createSignal, onCleanup, type Accessor, type Component } from 'solid-js';
import { t } from '../../../../core/i18n';
import type { CalibrationClient, ParamClient } from '../../../../contracts';
import type { SetupStep, SetupStepApi, SettledStatus } from '../framework';
import {
  EMPTY_RADIO_CAPTURE,
  RADIO_PWM_DISPLAY_MAX,
  RADIO_PWM_DISPLAY_MIN,
  accumulateRadioChannels,
  radioBarPercent,
  radioParamWrites,
  type RadioCaptureState,
  type RadioChannelCapture,
} from './capture';
import { registerRadioMessages } from './messages';
import './radio.css';

registerRadioMessages();

/** Dependencies injected into {@link createRadioStep}. */
export interface RadioStepDeps {
  /** Calibration microservice used only for the streaming radio capture. */
  readonly calibration: Pick<CalibrationClient, 'radio'>;
  /** Parameter microservice used to read cached RC params and write captured values. */
  readonly params: Pick<ParamClient, 'set' | 'get'>;
}

type RadioFlowState = 'idle' | 'running' | 'saving' | 'done' | 'warning';

interface CachedRadioParams {
  readonly min?: number;
  readonly max?: number;
  readonly trim?: number;
}

interface RadioPaneProps {
  readonly api: SetupStepApi;
  readonly deps: RadioStepDeps;
  readonly flow: Accessor<RadioFlowState>;
  readonly capture: Accessor<RadioCaptureState>;
  readonly error: Accessor<string | undefined>;
  readonly onStart: () => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function flowToSettledStatus(flow: RadioFlowState): SettledStatus {
  if (flow === 'done') return 'done';
  if (flow === 'warning') return 'warning';
  return 'todo';
}

function statusKey(flow: RadioFlowState): string {
  if (flow === 'running') return 'setup.radio.status.active';
  return `setup.radio.status.${flow}`;
}

function readCachedParams(
  params: Pick<ParamClient, 'get'>,
  index: number,
): CachedRadioParams | undefined {
  const min = params.get(`RC${index}_MIN`)?.value;
  const max = params.get(`RC${index}_MAX`)?.value;
  const trim = params.get(`RC${index}_TRIM`)?.value;
  if (min === undefined && max === undefined && trim === undefined) return undefined;
  return {
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(trim !== undefined ? { trim } : {}),
  };
}

function cachedText(api: SetupStepApi, cached: CachedRadioParams | undefined): string {
  if (cached === undefined) return api.t('setup.radio.channel.savedMissing');
  return api.t('setup.radio.channel.saved', {
    min: cached.min ?? '—',
    max: cached.max ?? '—',
    trim: cached.trim ?? '—',
  });
}

/** Build the Radio calibration {@link SetupStep}. */
export function createRadioStep(deps: RadioStepDeps): SetupStep {
  const [flow, setFlow] = createSignal<RadioFlowState>('idle');
  const [capture, setCapture] = createSignal<RadioCaptureState>(EMPTY_RADIO_CAPTURE);
  const [error, setError] = createSignal<string | undefined>(undefined);

  let controller: AbortController | undefined;

  const stopStream = (): void => {
    controller?.abort();
    controller = undefined;
  };

  const start = (): void => {
    stopStream();
    const ac = new AbortController();
    controller = ac;
    setError(undefined);
    setCapture(EMPTY_RADIO_CAPTURE);
    setFlow('running');

    void deps.calibration
      .radio((channels) => {
        if (ac.signal.aborted) return;
        setCapture((previous) => accumulateRadioChannels(previous, channels));
      }, ac.signal)
      .catch((err: unknown) => {
        if (ac.signal.aborted) return;
        setError(errorText(err));
        setFlow('warning');
      });
  };

  const cancel = (): void => {
    stopStream();
    setFlow('idle');
  };

  const save = (): void => {
    if (flow() !== 'running' || capture().channels.length === 0) return;
    setFlow('saving');
    setError(undefined);
    const writes = radioParamWrites(capture().channels);
    void (async (): Promise<void> => {
      try {
        for (const write of writes) await deps.params.set(write.name, write.value);
        setFlow('done');
      } catch (err) {
        setError(errorText(err));
        setFlow('warning');
      } finally {
        stopStream();
      }
    })();
  };

  const Pane: Component<{ readonly api: SetupStepApi }> = (props) => {
    onCleanup(() => stopStream());
    return (
      <RadioPane
        api={props.api}
        deps={deps}
        flow={flow}
        capture={capture}
        error={error}
        onStart={start}
        onCancel={cancel}
        onSave={save}
      />
    );
  };

  return {
    id: 'radio',
    title: t('setup.radio.title'),
    icon: '📻',
    safetyNote: t('setup.radio.safety'),
    status: () => flowToSettledStatus(flow()),
    allowManualComplete: false,
    render: (api) => <Pane api={api} />,
  };
}

/** Guided radio calibration pane rendered by the setup wizard. */
const RadioPane: Component<RadioPaneProps> = (props) => {
  const tr = props.api.t;
  const running = (): boolean => props.flow() === 'running';
  const canSave = (): boolean => running() && props.capture().channels.length > 0;
  const channelCount = (): number => props.capture().channels.length;

  return (
    <section class="mvp-setup-radio" aria-label={tr('setup.radio.title')} data-flow={props.flow()}>
      <p class="mvp-setup-radio__intro">{tr('setup.radio.intro')}</p>

      <div class="mvp-setup-radio__controls">
        <Show
          when={running()}
          fallback={
            <button
              type="button"
              class="mvp-setup-radio__button mvp-setup-radio__button--start"
              data-testid="radio-start"
              onClick={(): void => props.onStart()}
            >
              {props.flow() === 'done' ? tr('setup.radio.restart') : tr('setup.radio.start')}
            </button>
          }
        >
          <button
            type="button"
            class="mvp-setup-radio__button"
            data-testid="radio-cancel"
            onClick={(): void => props.onCancel()}
          >
            {tr('setup.radio.cancel')}
          </button>
          <button
            type="button"
            class="mvp-setup-radio__button mvp-setup-radio__button--save"
            data-testid="radio-save"
            disabled={!canSave()}
            onClick={(): void => props.onSave()}
          >
            {tr('setup.radio.save')}
          </button>
        </Show>
      </div>

      <p
        class="mvp-setup-radio__status"
        role={props.flow() === 'warning' ? 'alert' : 'status'}
        aria-live="polite"
        data-status={running() ? 'active' : props.flow()}
        data-testid="radio-status"
      >
        {props.flow() === 'warning'
          ? tr('setup.radio.status.warning', { message: props.error() ?? '' })
          : tr(statusKey(props.flow()))}
      </p>

      <Show
        when={channelCount() > 0}
        fallback={
          <p class="mvp-setup-radio__empty" role="status" data-testid="radio-empty">
            {tr('setup.radio.noChannels')}
          </p>
        }
      >
        <section class="mvp-setup-radio__channels" aria-labelledby="mvp-setup-radio-channels-title">
          <h3 id="mvp-setup-radio-channels-title">{tr('setup.radio.channels.title')}</h3>
          <div class="mvp-setup-radio__bars" data-testid="radio-bars">
            <For each={props.capture().channels}>
              {(channel) => <RadioChannelBar api={props.api} deps={props.deps} channel={channel} />}
            </For>
          </div>

          <table class="mvp-setup-radio__table" data-testid="radio-capture-table">
            <thead>
              <tr>
                <th scope="col">{tr('setup.radio.table.channel')}</th>
                <th scope="col">{tr('setup.radio.table.current')}</th>
                <th scope="col">{tr('setup.radio.table.min')}</th>
                <th scope="col">{tr('setup.radio.table.max')}</th>
                <th scope="col">{tr('setup.radio.table.trim')}</th>
                <th scope="col">{tr('setup.radio.table.samples')}</th>
              </tr>
            </thead>
            <tbody>
              <For each={props.capture().channels}>
                {(channel) => (
                  <tr data-testid={`radio-row-${channel.index}`}>
                    <th scope="row">{tr('setup.radio.channel.label', { n: channel.index })}</th>
                    <td data-testid={`radio-current-${channel.index}`}>{channel.current}</td>
                    <td data-testid={`radio-min-${channel.index}`}>{channel.min}</td>
                    <td data-testid={`radio-max-${channel.index}`}>{channel.max}</td>
                    <td data-testid={`radio-trim-${channel.index}`}>{channel.trim}</td>
                    <td>{channel.sampleCount}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </section>
      </Show>
    </section>
  );
};

function RadioChannelBar(props: {
  readonly api: SetupStepApi;
  readonly deps: RadioStepDeps;
  readonly channel: RadioChannelCapture;
}): ReturnType<Component> {
  const cached = (): CachedRadioParams | undefined =>
    readCachedParams(props.deps.params, props.channel.index);
  const pct = (): number => radioBarPercent(props.channel.current);
  return (
    <article class="mvp-setup-radio__channel" data-testid={`radio-channel-${props.channel.index}`}>
      <div class="mvp-setup-radio__channelhead">
        <h4>{props.api.t('setup.radio.channel.label', { n: props.channel.index })}</h4>
        <span>{props.api.t('setup.radio.channel.current', { value: props.channel.current })}</span>
      </div>
      <div
        class="mvp-setup-radio__meter"
        role="meter"
        aria-label={props.api.t('setup.radio.channel.label', { n: props.channel.index })}
        aria-valuemin={RADIO_PWM_DISPLAY_MIN}
        aria-valuemax={RADIO_PWM_DISPLAY_MAX}
        aria-valuenow={props.channel.current}
        aria-valuetext={props.api.t('setup.radio.channel.range', {
          min: props.channel.min,
          max: props.channel.max,
          trim: props.channel.trim,
        })}
      >
        <div class="mvp-setup-radio__meterfill" style={{ 'inline-size': `${pct()}%` }} />
      </div>
      <p class="mvp-setup-radio__range" data-testid={`radio-range-${props.channel.index}`}>
        {props.api.t('setup.radio.channel.range', {
          min: props.channel.min,
          max: props.channel.max,
          trim: props.channel.trim,
        })}
      </p>
      <p class="mvp-setup-radio__saved">{cachedText(props.api, cached())}</p>
    </article>
  );
}
